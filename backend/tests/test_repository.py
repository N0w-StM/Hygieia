"""Storage failover: lose MongoDB mid-run, keep working locally, sync when it returns."""
from app.repository import LocalStore, Repository


class FakeColl:
    def __init__(self, db):
        self.db, self.docs = db, {}

    def replace_one(self, flt, doc, upsert=False):
        if self.db.down:
            raise ConnectionError("link down")
        self.docs[flt["_id"]] = dict(doc)

    def find(self, flt):
        if self.db.down:
            raise ConnectionError("link down")
        return [{"_id": k, **v} for k, v in self.docs.items()]


class FakeDB:
    def __init__(self):
        self.down, self.colls = False, {}

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl(self))

    def command(self, _):
        if self.down:
            raise ConnectionError("link down")
        return {"ok": 1}


def make(tmp_path):
    repo = Repository(LocalStore(tmp_path), "mongodb://example.invalid/")
    repo._client, repo._db = object(), FakeDB()
    changes = []
    repo.on_mode_change = changes.append
    return repo, repo._db, changes


def test_failover_and_resync(tmp_path):
    repo, db, changes = make(tmp_path)
    db["alerts"].docs["REMOTE"] = {"alert_id": "REMOTE"}
    assert repo.connect() and repo.mode == "mongo"
    assert repo.get("alerts", "REMOTE") == {"alert_id": "REMOTE"}          # hydrated from MongoDB
    repo.upsert("alerts", "A1", {"alert_id": "A1"})
    assert db["alerts"].docs["A1"] == {"alert_id": "A1"}                   # mirrored

    db.down = True
    repo.upsert("alerts", "A2", {"alert_id": "A2"})                       # write must not fail
    assert repo.mode == "local" and repo.status()["pending_sync"] == 1
    assert repo.status()["reason"] == "unreachable:ConnectionError"       # type only, no driver text
    assert repo.get("alerts", "A2") == {"alert_id": "A2"} and "A2" not in db["alerts"].docs
    repo.upsert("messages", "M1", {"text": "offline"})
    assert not repo.connect() and repo.status()["pending_sync"] == 2

    db.down = False
    assert repo.connect() and repo.mode == "mongo" and repo.status()["pending_sync"] == 0
    assert db["alerts"].docs["A2"] == {"alert_id": "A2"} and db["messages"].docs["M1"] == {"text": "offline"}
    assert [c["mode"] for c in changes] == ["mongo", "local", "mongo"]


def test_local_edit_made_offline_is_not_overwritten_by_hydrate(tmp_path):
    repo, db, _ = make(tmp_path)
    repo.connect()
    repo.upsert("alerts", "A1", {"alert_id": "A1", "acknowledged_by": None})
    db.down = True
    repo.upsert("alerts", "A1", {"alert_id": "A1", "acknowledged_by": "Dr. Lena Ortiz"})
    db.down = False
    repo.connect()
    assert repo.get("alerts", "A1")["acknowledged_by"] == "Dr. Lena Ortiz"
    assert db["alerts"].docs["A1"]["acknowledged_by"] == "Dr. Lena Ortiz"


def test_no_uri_never_queues(tmp_path):
    repo = Repository(LocalStore(tmp_path), None)
    assert not repo.connect() and repo.status()["reason"] == "not_configured"
    repo.upsert("alerts", "A1", {"alert_id": "A1"})
    assert repo.status()["pending_sync"] == 0
    assert Repository(LocalStore(tmp_path), None).get("alerts", "A1") == {"alert_id": "A1"}   # on disk
