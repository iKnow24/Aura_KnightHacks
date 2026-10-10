import pytest

from app import main


@pytest.fixture(autouse=True)
def reset_cooldowns():
    main.last_alert.clear()
    yield
