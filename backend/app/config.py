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
    mongodb_uri: str | None = field(default=None, repr=False)
    mongodb_db: str = "hygieia"
    seconds_per_slot: float = 5.0
    start_day: int = 79
    autoplay: bool = True
    reconnect_seconds: float = 20.0
    gemini_api_key: str | None = field(default=None, repr=False)  # never log or return it
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_timeout: float = 12.0

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
            gemini_api_key=(os.getenv("GEMINI_API_KEY") or "").strip() or None,
            gemini_model=(os.getenv("GEMINI_MODEL") or "gemini-3.5-flash-lite").strip(),
            gemini_timeout=float(os.getenv("GEMINI_TIMEOUT_SECONDS") or 12),
        )
