"""Runtime settings. Secrets come from the git-ignored .env only; never log the URI."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    model_dir: Path = field(default_factory=lambda: ROOT / "Model")
    data_dir: Path = field(default_factory=lambda: ROOT / "backend" / "data")
    mongodb_uri: str | None = None
    mongodb_db: str = "hygieia"
    seconds_per_slot: float = 5.0
    start_day: int = 79
    autoplay: bool = True
    reconnect_seconds: float = 20.0

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(ROOT / ".env")
        return cls(
            mongodb_uri=(os.getenv("MONGODB_URI") or "").strip() or None,
            mongodb_db=(os.getenv("MONGODB_DB") or "hygieia").strip(),
            data_dir=Path(os.getenv("HYGIEIA_DATA_DIR") or ROOT / "backend" / "data"),
            seconds_per_slot=float(os.getenv("REPLAY_SECONDS_PER_SLOT") or 5),
            start_day=int(os.getenv("REPLAY_START_DAY") or 79),
            autoplay=(os.getenv("REPLAY_AUTOPLAY") or "1") not in ("0", "false", "False"),
        )
