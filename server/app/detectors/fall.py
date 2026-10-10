"""Fall detector from pose keypoints. No video, no AI model: just geometry over time.

Each node phone runs MediaPipe Pose in the browser and sends 33 landmarks per frame
([x, y, visibility], x/y from 0 to 1, y grows downward). A fall is all three of:

1. the torso tips over: shoulders-to-hips line more than 60 degrees from vertical,
2. fast: the hips drop by more than 40% of the person's standing height within 1 second,
3. then the person stays down and still for `stillness_s` seconds.

If the person leaves the frame, that's "unknown", never "fallen". Sitting down slowly,
lying on the couch, or bending over fail rule 1 or 2, so they don't fire.
"""
import math
from collections import deque

# MediaPipe Pose landmark indexes
NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_ANKLE, R_ANKLE = 0, 11, 12, 23, 24, 27, 28

TILT_FALLEN = 60  # degrees from vertical
TILT_UPRIGHT = 30
DROP_FRACTION = 0.4
DROP_WINDOW_S = 1.0
MOVE_TOLERANCE = 0.05  # hip movement (fraction of frame) that still counts as "still"
MIN_VISIBILITY = 0.5


def _mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _visible(lm, *idx):
    return all(len(lm[i]) < 3 or lm[i][2] >= MIN_VISIBILITY for i in idx)


def torso_tilt(lm) -> float:
    """Degrees between the hips->shoulders line and straight up."""
    sh = _mid(lm[L_SHOULDER], lm[R_SHOULDER])
    hip = _mid(lm[L_HIP], lm[R_HIP])
    dx, dy = sh[0] - hip[0], hip[1] - sh[1]  # dy > 0 when shoulders are above hips
    return math.degrees(math.atan2(abs(dx), dy)) if (dx or dy) else 0.0


class FallDetector:
    """One per camera node. Call update() for every pose frame; it returns True once per fall."""

    def __init__(self, stillness_s: float = 8.0):
        self.stillness_s = stillness_s
        self.standing_height = None  # nose-to-ankle height, learned while upright
        self.hips = deque()  # (ts, hip_y) over the last DROP_WINDOW_S
        self.state = "ok"  # ok | down | alerted
        self.anchor = None  # hip position when the person last moved while down
        self.still_since = None

    def update(self, ts: float, landmarks) -> bool:
        if not landmarks or not _visible(landmarks, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP):
            # Person out of frame or hidden: we don't know, so we don't alert.
            self.state, self.hips = "ok", deque()
            return False

        tilt = torso_tilt(landmarks)
        hip = _mid(landmarks[L_HIP], landmarks[R_HIP])

        if tilt < TILT_UPRIGHT and _visible(landmarks, NOSE, L_ANKLE, R_ANKLE):
            ankle_y = max(landmarks[L_ANKLE][1], landmarks[R_ANKLE][1])
            self.standing_height = ankle_y - landmarks[NOSE][1]

        self.hips.append((ts, hip[1]))
        while self.hips and ts - self.hips[0][0] > DROP_WINDOW_S:
            self.hips.popleft()

        if self.state == "ok":
            if self.standing_height and tilt > TILT_FALLEN:
                drop = hip[1] - min(y for _, y in self.hips)
                if drop > DROP_FRACTION * self.standing_height:
                    self.state, self.anchor, self.still_since = "down", hip, ts
            return False

        if tilt < TILT_FALLEN - 15:  # got back up
            self.state = "ok"
            return False

        if self.state == "down":
            if math.dist(hip, self.anchor) > MOVE_TOLERANCE:
                self.anchor, self.still_since = hip, ts  # moving on the floor resets the timer
            elif ts - self.still_since >= self.stillness_s:
                self.state = "alerted"
                return True
        return False
