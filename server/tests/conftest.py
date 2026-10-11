import os

import pytest

os.environ["VOICE_FILE"] = ""  # tests never read or write the real saved voices

from app import main


@pytest.fixture(autouse=True)
def reset_cooldowns():
    main.last_alert.clear()
    yield
