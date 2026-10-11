"""Finds MediaPipe's 478 face points in images, for fitting the avatar's face to a photo.

    python scripts/avatar/face_landmarks.py IMAGE [IMAGE ...] > points.json

Prints {image: {"size": [w, h], "points": [[x, y], ...]}} in pixels (y down), or null for an image
with no face. Runs locally with the same face model the web app uses; nothing is uploaded.
"""
import json
import pathlib
import sys

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions

MODEL = pathlib.Path(__file__).resolve().parents[2] / "web" / "public" / "mediapipe" / "face_landmarker.task"


def main(paths):
    opts = FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODEL)), num_faces=1)
    out = {}
    with FaceLandmarker.create_from_options(opts) as finder:
        for p in paths:
            img = mp.Image.create_from_file(p)
            found = finder.detect(img).face_landmarks
            w, h = img.width, img.height
            out[p] = {"size": [w, h], "points": [[q.x * w, q.y * h] for q in found[0]]} if found else None
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
