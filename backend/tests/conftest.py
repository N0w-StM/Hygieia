import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.model_service import get_model_service  # noqa: E402


@pytest.fixture(scope="session")
def model():
    return get_model_service(str(ROOT / "Model"))
