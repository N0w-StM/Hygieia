#!/usr/bin/env python
"""Reset Hygieia demo data. Run from the repo root, with the backend stopped:

    backend/.venv/bin/python backend/scripts/reset_data.py            # dry run: print counts only
    backend/.venv/bin/python backend/scripts/reset_data.py --yes      # delete the documents
    backend/.venv/bin/python backend/scripts/reset_data.py --yes --local   # also empty the local store

Scope, on purpose:
- database: always "hygieia" (hard-coded; MONGODB_DB is ignored here)
- collections: only Hygieia's own (crew, records, alerts, messages, checkins)
- operation: delete_many({}) on those collections. It never drops a collection or the
  database and never touches any other collection or database.
Idempotent: running it again on empty collections deletes 0 documents.
The backend re-seeds `crew` from the dataset on its next start.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402

DB_NAME = "hygieia"
COLLECTIONS = ("crew", "records", "alerts", "messages", "checkins")
LOCAL_FILES = COLLECTIONS + ("_pending",)


def reset_mongo(uri: str, do_delete: bool) -> int:
    from pymongo import MongoClient
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=8000, connectTimeoutMS=10000)
        db = client[DB_NAME]
        db.command("ping")
        existing = set(db.list_collection_names())
    except Exception as e:  # noqa: BLE001 - driver text can contain hosts/users
        print(f"MongoDB: could not connect ({type(e).__name__}). Nothing was changed.")
        return 1
    others = sorted(existing - set(COLLECTIONS))
    print(f'MongoDB database "{DB_NAME}":')
    counts = {c: db[c].count_documents({}) for c in COLLECTIONS if c in existing}
    for c in COLLECTIONS:
        print(f"  {c:<9} {counts[c]:>6} documents" if c in counts else f"  {c:<9}      - (collection does not exist)")
    if others:
        print(f"  not Hygieia's, left untouched: {', '.join(others)}")
    if not do_delete:
        print("Dry run: nothing deleted. Re-run with --yes to delete these documents.")
        return 0
    for c, n in counts.items():
        deleted = db[c].delete_many({}).deleted_count
        print(f"  deleted {deleted} from {c}" + ("" if deleted == n else f" (counted {n} just before)"))
    print("MongoDB: done. Collections and database were kept; only documents were removed.")
    return 0


def reset_local(data_dir: Path, do_delete: bool) -> None:
    local = data_dir / "local"
    print(f"Local store ({local}):")
    for name in LOCAL_FILES:
        p = local / f"{name}.json"
        if not p.exists():
            print(f"  {name:<9}      - (no file)")
            continue
        try:
            n = len(json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            n = "unreadable"
        print(f"  {name:<9} {n:>6} entries")
        if do_delete:
            p.write_text("{}", encoding="utf-8")
    print("Local store: emptied." if do_delete else "Dry run: local store unchanged.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete Hygieia demo documents (dry run by default).")
    ap.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    ap.add_argument("--local", action="store_true", help="also empty the local JSON fallback store")
    args = ap.parse_args()
    settings = Settings.from_env()
    rc = 0
    if settings.mongodb_uri:
        rc = reset_mongo(settings.mongodb_uri, args.yes)
    else:
        print("MongoDB: MONGODB_URI is not set, skipping.")
    if args.local:
        reset_local(settings.data_dir, args.yes)
    else:
        print("Local store: not touched (add --local to include it).")
    return rc


if __name__ == "__main__":
    sys.exit(main())
