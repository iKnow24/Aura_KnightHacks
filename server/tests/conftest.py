import os

os.environ["LUMEN_TESTING"] = "1"
os.environ["VOICE_FILE"] = ""  # tests never read or write the real saved voices

import pytest

from app import main


@pytest.fixture(autouse=True)
def reset_cooldowns():
    main.last_alert.clear()
    yield
