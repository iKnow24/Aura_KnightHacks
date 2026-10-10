# The agent line

How we use AI coding agents this weekend without burning through everyone's usage limits.

## Blunt version first

Agents are not our bottleneck. The things that will actually sink us are physical: phones overheating,
venue Wi-Fi blocking the phones from each other, the headset camera being blocked, a fall not
detected on the crash mat. No agent fixes those. So agents get the boring code, and humans spend
their hours testing on real hardware.

## The shape: one line, then three branches

```
            ┌──────────── LINE (one agent, done once, already done) ───────────┐
 idea ──► plan ──► event contract ──► skeleton app + fake alerts ──► tests pass
                                                    │
               ┌────────────────────────────────────┼────────────────────────────────────┐
               ▼                                    ▼                                    ▼
      BRANCH A: brain                      BRANCH B: nodes + vision             BRANCH C: screens
      server/  (person 1)                  web/src/pages/Node.jsx (person 2)    Dashboard, Headset, Strobe
      AST on AMD, fusion, name call        MediaPipe pose → fall rules          (person 3)
               │                                    │                                    │
               └──────────────► MERGE (one review pass at each checkpoint) ◄────────────┘
                                                    ▼
                                          demo rehearsal + video
```

**The line** is the work that must happen in order: the plan, the event format every part agrees on,
and a skeleton where a fake alert already flows from the dashboard to every screen. That's done in
this repo. Nobody waits on anyone after this point.

**The branches** run in parallel because they only touch their own folders and only talk to each other
through the event format below. Each person runs **one** agent session in their branch. Not three. One.

**The merge** happens at checkpoints (Saturday noon, Saturday 8 PM, Sunday 6 AM). One person merges,
runs `pytest` and `npm run build`, and runs the demo with fake alerts. If it breaks, the branch that
broke it fixes it before anything else.

## The contract every branch codes against

Every alert in the system is this JSON, and nothing else (see `server/app/hub.py`):

```json
{"type": "alert", "id": "1728540000.123", "kind": "smoke_alarm", "zone": "kitchen",
 "severity": "critical", "source": "alarm_dsp", "confidence": 0.97, "ts": 1728540000.1}
```

- `kind`: smoke_alarm, doorbell, name_called, fall, glass_break, baby_cry
  - everyday (home): timer, kettle, phone_ring, knock, alarm_clock, water_running, dog_bark, car_alarm
  - outside: car_horn, siren, vehicle (only when getting louder), bike_bell, reversing,
    person_behind, vehicle_behind, bike_behind (from the rear camera phone, zone `behind`)
  - Each mode's `sound_kinds` in `server/app/modes.py` decides which of these it listens for.
- `severity`: critical, warning, info. The current mode decides which screens get each one (`server/app/modes.py`).
- Branch A produces these. Branch B produces raw audio and pose keypoints. Branch C only consumes alerts.
- Branch C never waits on A: the dashboard's fake-alert buttons call `POST /api/fake-alert`.

Change the contract only with all three people agreeing, and change it in one commit.

Two more message types go out on the same sockets. They are not alerts, so screens can ignore them:

```json
{"type": "caption", "zone": "kitchen", "text": "Dinner's ready!", "ts": 1728540000.1}   // dashboard + hud
{"type": "sighting", "item": "keys", "zone": "living", "ts": 1728540000.1}             // dashboard
```

Nodes send `{"type": "snapshot", "ts": ..., "jpeg": "data:image/jpeg;base64,..."}` every 5 s (turn off with `?items=0`).
Captions carry `"id"` and, when a louder speaker mic heard the same sentence, `"replaces": old_id`
(see `server/app/speakers.py`). Browser captions are saved with `POST /api/speech {"text"}`.
Voice "add a new mode": `POST /api/modes {"description"}` builds a mode, switches to it, returns `{"key", "label", "sound_kinds", ...}`.
Acknowledging: any screen calls `POST /api/ack {"id": alert_id, "by": "wearer"}`; every screen gets
`{"type": "ack", "id", "ts", "by"}` and drops the alert, and the dashboard timeline shows "seen at".
Rear guard phone sends `{"type": "approach", "label": "person" | "car" | ..., "score", "area"}` on its node socket.
Lecture recap: `POST /api/recap {"segments": [{"text", "ts"}], "title"}` returns
`{"title", "summary", "points", "map": {"center", "branches": [{"label", "ts", "details"}]}, "quiz": [{"q", "choices", "answer"}], "people", "brain": "local" | "hf" | "claude" | "rules"}`.
Ask Lumen: `POST /api/ask {"question": "..."}` returns `{"answer", "evidence": [log entries], "brain": "claude" | "rules"}`.

## Git, plainly

```bash
git checkout main && git pull
git checkout -b brain          # or: nodes, screens
# ...work, commit often...
git push -u origin brain       # then open a pull request into main on GitHub
```

Never commit straight to `main`. Pull `main` into your branch after each checkpoint merge.

## Keeping it cheap (usage limits are the budget)

Every agent session counts against the Claude plan of whoever runs it. Rules:

1. **One agent per human, max.** Parallel agent swarms feel productive and burn limits in minutes.
2. **Small, specific asks.** "Add a `fall` detector in `server/app/detectors/fall.py` that takes 33 pose
   keypoints and returns True when…" beats "make fall detection work".
3. **Plan before code.** Ask for the plan first, read it, then say go. Rewrites are the expensive part.
4. **Start fresh between tasks** (`/clear` in Claude Code). A long conversation re-reads its whole history
   on every message, which costs more and gets worse.
5. **Use the smaller model for small stuff** (renames, CSS tweaks, explaining an error).
6. **Don't let an agent loop on a hardware problem.** If the phone can't reach the server, that's Wi-Fi,
   not code. Walk over to the router.
7. **In the Claude project:** each thread is its own agent. Start a new thread only for a genuinely new
   task, and resolve threads when done.

## Prompts to start each branch

Copy one of these into a fresh agent session in your branch.

**A, brain:** "Read CLAUDE.md and docs/agent-line.md. I own server/. Add an AST sound classifier in
server/app/detectors/ast_sound.py using MIT/ast-finetuned-audioset-10-10-0.4593 on 3 s windows, map AudioSet
labels to our `kind` values, and emit alerts through hub.emit_alert. Plan first, don't touch web/."

**B, nodes + vision:** "Read CLAUDE.md and docs/agent-line.md. I own web/src/pages/Node.jsx. Add MediaPipe
Pose Landmarker in the browser at 10 fps and send keypoints as JSON over the existing node socket. Then
write server/app/detectors/fall.py with the rules in the analysis doc. Plan first."

**C, screens:** "Read CLAUDE.md and docs/agent-line.md. I own Dashboard.jsx, Headset.jsx and Strobe.jsx.
Make the headset glow look great and test it on a real phone through the tunnel. Use the fake-alert
buttons only; don't touch server/. Plan first."
