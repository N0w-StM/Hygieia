"""Storage: local JSON store (always on) + MongoDB mirror (when reachable).

- Every write lands in the local store first, so the app runs 100% offline.
- When MongoDB is reachable, writes are mirrored there and small collections are hydrated
  from it at startup. If it becomes unreachable, the app keeps running on the local store,
  queues the keys it could not mirror, and pushes them when the link returns.
- Reads are always served from the local store (fast, never blocked by the network).

Never log the connection string or raw driver errors (they can embed hosts and users).
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Callable

log = logging.getLogger("hygieia.storage")

COLLECTIONS = ("crew", "records", "alerts", "messages", "checkins")
HYDRATED = ("crew", "alerts", "messages", "checkins")  # records are re-derivable from the dataset
RECORDS_CAP = 6000


class LocalStore:
    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._data: dict[str, dict[str, dict]] = {}
        self._dirty: set[str] = set()
        for c in COLLECTIONS + ("_pending",):
            self._data[c] = self._load(c)

    def _path(self, coll: str) -> Path:
        return self.dir / f"{coll}.json"

    def _load(self, coll: str) -> dict:
        try:
            with open(self._path(coll), encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except FileNotFoundError:
            return {}
        except (json.JSONDecodeError, OSError):
            log.warning("Local store file for %s was unreadable; starting empty", coll)
            return {}

    def upsert(self, coll: str, key: str, doc: dict, flush: bool = True):
        with self._lock:
            d = self._data[coll]
            d[key] = doc
            if coll == "records" and len(d) > RECORDS_CAP:
                for k in list(d)[: len(d) - RECORDS_CAP]:
                    del d[k]
            self._dirty.add(coll)
            if flush:
                self.flush(coll)

    def delete(self, coll: str, key: str):
        with self._lock:
            if self._data[coll].pop(key, None) is not None:
                self._dirty.add(coll)
                self.flush(coll)

    def get(self, coll: str, key: str) -> dict | None:
        with self._lock:
            doc = self._data[coll].get(key)
            return dict(doc) if doc is not None else None

    def find(self, coll: str, pred: Callable[[dict], bool] | None = None) -> list[dict]:
        with self._lock:
            return [dict(d) for d in self._data[coll].values() if pred is None or pred(d)]

    def keys(self, coll: str) -> list[str]:
        with self._lock:
            return list(self._data[coll])

    def flush(self, coll: str | None = None):
        with self._lock:
            for c in ([coll] if coll else list(self._dirty)):
                if c not in self._dirty:
                    continue
                tmp = self._path(c).with_suffix(".json.tmp")
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self._data[c], f, ensure_ascii=False)
                os.replace(tmp, self._path(c))
                self._dirty.discard(c)


class Repository:
    def __init__(self, local: LocalStore, mongodb_uri: str | None, db_name: str = "hygieia"):
        self.local = local
        self._uri = mongodb_uri
        self._db_name = db_name
        self._client = None
        self._db = None
        self._lock = threading.RLock()
        self.mode = "local"            # "mongo" | "local"
        self.reason = "not_configured" if not mongodb_uri else "not_connected"
        self.on_mode_change: Callable[[dict], None] | None = None

    # ---- status -----------------------------------------------------------------------
    def status(self) -> dict:
        return {
            "mode": self.mode,
            "offline": self.mode != "mongo",
            "reason": None if self.mode == "mongo" else self.reason,
            "pending_sync": len(self.local.keys("_pending")),
        }

    def _set_mode(self, mode: str, reason: str | None = None):
        changed = mode != self.mode
        self.mode, self.reason = mode, reason
        if changed:
            log.info("Storage mode: %s%s", mode, f" ({reason})" if reason else "")
            if self.on_mode_change:
                self.on_mode_change(self.status())

    # ---- mongo ------------------------------------------------------------------------
    def connect(self) -> bool:
        """Try to reach MongoDB. Safe to call repeatedly (used for reconnects)."""
        if not self._uri:
            self._set_mode("local", "not_configured")
            return False
        with self._lock:
            try:
                if self._client is None:
                    from pymongo import MongoClient
                    # connectTimeoutMS also bounds the SRV DNS lookup, which can take several
                    # seconds on a slow resolver; 4 s was observed to time out intermittently.
                    self._client = MongoClient(self._uri, serverSelectionTimeoutMS=6000,
                                               connectTimeoutMS=10000, socketTimeoutMS=10000,
                                               appname="hygieia-backend")
                    self._db = self._client[self._db_name]
                self._db.command("ping")
                self._hydrate()
                self._push_pending()
            except Exception as e:  # noqa: BLE001 - never surface driver text
                if self._db is None and self._client is not None:
                    self._client.close()
                self._client = None if self._db is None else self._client
                self._set_mode("local", f"unreachable:{type(e).__name__}")
                return False
            self._set_mode("mongo")
            return True

    def _hydrate(self):
        for coll in HYDRATED:
            known = set(self.local.keys(coll))
            pending = {k for k in self.local.keys("_pending") if k.startswith(coll + "/")}
            for doc in self._db[coll].find({}):
                key = str(doc.pop("_id"))
                if key not in known and f"{coll}/{key}" not in pending:
                    self.local.upsert(coll, key, doc, flush=False)
            self.local.flush(coll)

    def _push_pending(self):
        for pk in self.local.keys("_pending"):
            coll, key = pk.split("/", 1)
            doc = self.local.get(coll, key)
            if doc is not None:
                self._db[coll].replace_one({"_id": key}, doc, upsert=True)
            self.local.delete("_pending", pk)

    def _go_offline(self, exc: Exception):
        self._set_mode("local", f"unreachable:{type(exc).__name__}")

    # ---- CRUD -------------------------------------------------------------------------
    def upsert(self, coll: str, key: str, doc: dict):
        self.local.upsert(coll, key, doc, flush=coll != "records")
        if self.mode == "mongo":
            try:
                self._db[coll].replace_one({"_id": key}, doc, upsert=True)
                return
            except Exception as e:  # noqa: BLE001
                self._go_offline(e)
        if self._uri:  # remember what still has to reach MongoDB
            self.local.upsert("_pending", f"{coll}/{key}", {"c": coll}, flush=coll != "records")

    def get(self, coll: str, key: str) -> dict | None:
        return self.local.get(coll, key)

    def find(self, coll: str, pred: Callable[[dict], bool] | None = None) -> list[dict]:
        return self.local.find(coll, pred)

    def flush(self):
        self.local.flush()

    def close(self):
        self.local.flush()
        if self._client is not None:
            self._client.close()
