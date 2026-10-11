"""Voice labels with fake voiceprints: each fake person's voice is a fixed direction plus a little noise."""
import asyncio

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.detectors.voices import Voices, VoiceBook, name_in

rng = np.random.default_rng(0)
SAMEISH = 0.15  # noise level that keeps one person's clips well above the match cut-off


def person():
    return rng.normal(size=512)


def clip(voice, noise=SAMEISH):
    return voice + noise * np.linalg.norm(voice) / np.sqrt(512) * rng.normal(size=512)


def test_name_in():
    assert name_in("Hi, my name is sharan and I built this") == "Sharan"
    assert name_in("My name's Kha.") == "Kha"
    assert name_in("my name is not important") is None
    assert name_in("I'm going home") is None


def test_enrolled_teammate_is_named_and_judges_get_letters():
    book = VoiceBook()
    sharan, judge1, judge2 = person(), person(), person()
    book.enroll("Sharan", clip(sharan))
    assert book.identify(clip(sharan))["voice"] == "Sharan"
    a = book.identify(clip(judge1))
    assert a == {**a, "voice": "Person 2", "voice_known": False}
    assert book.identify(clip(judge2))["voice"] == "Person 3"
    assert book.identify(clip(judge1))["voice"] == "Person 2"
    assert book.identify(clip(sharan))["voice"] == "Sharan"


def test_enrolling_a_speaker_letter_merges_it():
    book = VoiceBook()
    kha = person()
    assert book.identify(clip(kha))["voice"] == "Person 1"
    book.enroll("Kha", clip(kha))
    assert book.guests == []
    assert book.identify(clip(kha))["voice"] == "Kha"


def test_in_between_voice_gets_no_label():
    book = VoiceBook()
    sharan = person()
    book.enroll("Sharan", sharan)
    # Cosine ~0.74 to Sharan: not clearly Sharan, not clearly someone new.
    blur = sharan / np.linalg.norm(sharan) + 0.9 * (lambda v: v / np.linalg.norm(v))(person())
    assert book.identify(blur) is None
    assert book.guests == []


def test_summary_never_includes_voiceprints():
    book = VoiceBook()
    book.enroll("Sharan", person())
    s = book.summary()
    assert s["people"] == [{"name": "Sharan", "lines": 1}]
    assert "vec" not in str(s)
    book.forget()
    assert book.summary()["people"] == []


def test_short_lines_are_not_labeled():
    voices = Voices(embed=lambda audio: np.ones(512))
    assert voices.label(np.zeros(16000, np.float32), "yeah") is None
    assert voices.label(np.zeros(24000, np.float32), "how does it work?")["voice"] == "Person 1"


def test_caption_carries_the_voice(monkeypatch):
    sharan = person()
    fake = Voices(embed=lambda audio: clip(sharan))
    monkeypatch.setattr(main, "voices", fake)
    said = iter(["Hi, my name is Sharan and this is Lumen", "So the strobe flashes at night"])
    monkeypatch.setattr(main.transcriber, "transcribe", lambda audio: next(said))
    client = TestClient(main.app)

    async def say():
        """The words go out first, then naming the voice finishes in its own task."""
        await main.run_speech("living", np.full(32000, 0.1, np.float32))
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not asyncio.current_task()])

    with client.websocket_connect("/ws/hud") as hud:
        hud.receive_json()
        asyncio.run(say())
        words, first = hud.receive_json(), hud.receive_json()
        asyncio.run(say())
        hud.receive_json()
        second = hud.receive_json()
    assert words["type"] == "caption" and "voice" not in words  # the line doesn't wait for the name
    assert first["type"] == "caption_voice" and first["voice"] == "Sharan" and first["enrolled"]
    assert second["voice"] == "Sharan" and second["voice_known"]
    assert main.memory.entries[-1]["voice"] == "Sharan"
    assert client.get("/api/voices").json()["people"] == [{"name": "Sharan", "lines": 2}]
    client.post("/api/voices/forget")
    assert client.get("/api/voices").json()["people"] == []


def test_teammates_are_saved_and_judges_are_not(tmp_path):
    path = str(tmp_path / "voices.json")
    book = VoiceBook(path)
    team = {name: person() for name in ("Sharan", "Kha", "Dana")}
    for name, voice in team.items():
        book.enroll(name, clip(voice))
    judge = person()
    assert book.identify(clip(judge))["voice"] == "Person 4"
    # Brain restarts: the team is remembered, the judge is not.
    again = VoiceBook(path)
    assert sorted(again.people) == ["Dana", "Kha", "Sharan"]
    assert again.identify(clip(team["Kha"]))["voice"] == "Kha"
    assert again.guests == [] and "Person" not in open(path).read()
    again.forget()
    assert not (tmp_path / "voices.json").exists()


def test_voices_page_enroll_who_remove(monkeypatch):
    import base64
    sharan, kha = person(), person()
    current = {"voice": sharan}
    monkeypatch.setattr(main, "voices", Voices(embed=lambda audio: clip(current["voice"])))
    client = TestClient(main.app)
    clip_b64 = base64.b64encode(np.full(16000 * 3, 0.05, np.float32).tobytes()).decode()
    r = client.post("/api/voices/enroll", json={"name": "  sharan ", "audio": clip_b64})
    assert r.json()["people"] == [{"name": "Sharan", "lines": 1}]
    current["voice"] = kha
    client.post("/api/voices/enroll", json={"name": "Kha", "audio": clip_b64})
    assert client.post("/api/voices/who", json={"audio": clip_b64}).json()["voice"] == "Kha"
    short = base64.b64encode(np.full(8000, 0.05, np.float32).tobytes()).decode()
    assert client.post("/api/voices/enroll", json={"name": "Kha", "audio": short}).status_code == 400
    assert client.post("/api/voices/enroll", json={"name": "", "audio": clip_b64}).status_code == 400
    left = client.post("/api/voices/remove", json={"name": "Kha"}).json()["people"]
    assert left == [{"name": "Sharan", "lines": 1}]


def test_long_reading_and_backup_restore(monkeypatch, tmp_path):
    import base64
    sharan = person()
    monkeypatch.setattr(main, "voices", Voices(embed=lambda audio: clip(sharan)))
    main.voices.book.path = str(tmp_path / "v.json")
    client = TestClient(main.app)
    minute = np.full(16000 * 60, 0.05, np.float32)
    minute[16000 * 20:16000 * 26] = 0  # a pause gets skipped
    r = client.post("/api/voices/enroll", json={"name": "Sharan", "audio": base64.b64encode(minute.tobytes()).decode()})
    assert r.json()["people"][0]["lines"] >= 8
    saved = client.get("/api/voices/backup").json()
    main.voices.book.guests.append({"label": "Person 2", "vec": unit_vec(), "n": 1})
    assert "Person" not in str(client.get("/api/voices/backup").json())
    main.voices.book.forget()
    assert client.post("/api/voices/restore", json=saved).json()["people"][0]["name"] == "Sharan"
    assert client.post("/api/voices/restore", json={"people": {"x": {"vec": [1, 2]}}}).status_code == 400


def unit_vec():
    v = person()
    return v / np.linalg.norm(v)
