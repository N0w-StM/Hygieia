"""reset_data.py: deletes only documents in Hygieia's collections of the "hygieia" database."""
import importlib.util
from pathlib import Path

import pymongo

spec = importlib.util.spec_from_file_location("reset_data", Path(__file__).parents[1] / "scripts" / "reset_data.py")
reset_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset_data)


class Coll:
    def __init__(self, n):
        self.n = n

    def count_documents(self, flt):
        assert flt == {}
        return self.n

    def delete_many(self, flt):
        assert flt == {}
        n, self.n = self.n, 0
        return type("R", (), {"deleted_count": n})()


class DB:
    def __init__(self):
        self.colls = {"crew": Coll(6), "alerts": Coll(13), "someone_elses": Coll(99)}

    def command(self, _):
        return {"ok": 1}

    def list_collection_names(self):
        return list(self.colls)

    def __getitem__(self, name):
        return self.colls[name]

    def __getattr__(self, name):  # drop_collection, drop_database, ... must never be called
        raise AssertionError(f"unexpected call: {name}")


class Client:
    opened = []

    def __init__(self, *a, **k):
        self.db = DB()

    def __getitem__(self, name):
        Client.opened.append(name)
        return self.db

    def __getattr__(self, name):
        raise AssertionError(f"unexpected call: {name}")


def test_dry_run_then_delete_then_idempotent(monkeypatch, capsys):
    client = Client()
    monkeypatch.setattr(pymongo, "MongoClient", lambda *a, **k: client)
    assert reset_data.reset_mongo("mongodb://secret-user:secret-pass@secret-host/", do_delete=False) == 0
    assert (client.db.colls["crew"].n, client.db.colls["alerts"].n) == (6, 13)          # dry run
    assert reset_data.reset_mongo("mongodb://secret-user:secret-pass@secret-host/", do_delete=True) == 0
    assert (client.db.colls["crew"].n, client.db.colls["alerts"].n) == (0, 0)
    assert client.db.colls["someone_elses"].n == 99                                     # untouched
    assert reset_data.reset_mongo("mongodb://secret-user:secret-pass@secret-host/", do_delete=True) == 0
    assert set(Client.opened) == {"hygieia"}
    out = capsys.readouterr().out
    assert "secret" not in out and "left untouched: someone_elses" in out and "deleted 13 from alerts" in out


def test_connection_failure_prints_no_driver_text(monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("mongodb://secret-user:secret-pass@secret-host/ refused")
    monkeypatch.setattr(pymongo, "MongoClient", boom)
    assert reset_data.reset_mongo("mongodb://x/", do_delete=True) == 1
    assert "secret" not in capsys.readouterr().out
