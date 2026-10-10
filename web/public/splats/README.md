# Room scan for the captions corner

The Room view (tap the 3D corner on /captions) draws a Gaussian splat of a real room around you.
`sample-room.splat` is a fake room made by `scripts/make_sample_splat.py` so the view works today.

To use a real scan of the demo room:

1. Scan it with **Scaniverse** (free, iPhone and Android). Walk the room slowly, 1 to 2 minutes.
2. In the app, crop away the ceiling and anything outside the room, then export as **SPZ**
   (small, about 10x smaller than PLY). Keep it under ~10 MB; the phone downloads it over the tunnel.
3. Drop the file here, e.g. `web/public/splats/demo-room.spz`, and set `"file"` in `room.json`.
4. Line it up: `position` moves the room (meters, y up), `rotation` is a quaternion `[x, y, z, w]`,
   `scale` resizes it. If the room shows upside down, use `"rotation": [1, 0, 0, 0]`.
   You stand at `[0, 0, 0]`, facing `-z`.

If the file is missing or the phone can't draw it, the corner goes back to the street view on its own.

## Dashboard (3D button on the floor plan)

The caregiver dashboard shows the same scan full size, slowly turning, with a dot for each room the
phones watch. `zones` in `room.json` says where each dot sits in the scan (meters, same frame as the
scan after `position`/`rotation`/`scale`). When an alert fires, its room's dot ripples in the alert color.
