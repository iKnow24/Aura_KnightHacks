# Connecting the demo phones

Use the same shared HTTPS tunnel address on the laptop, S25, iPhone 17, and iPhone 13 Pro Max.
The tunnel must reach the running brain through the existing Mac/Jupyter bridge or the laptop backup.
Do not use localhost on a phone: that points to the phone itself. Use a normal app build with VITE_DEMO unset.

1. On the brain, set `LUMEN_DEMO_PREVIEW=1` before starting/restarting the FastAPI server if you want camera images on the laptop.
2. On the laptop, open `/dashboard`, sign in, and choose **Add phones** to show room QR codes.
3. On the S25, open the Kitchen node QR code in Chrome. On the iPhone 17, open Living room in Safari.
   On the iPhone 13 Pro Max, open Bedroom in Safari. These assignments can be changed with `?zone=`.
4. On each phone, check **Show camera on laptop** and tap **Start camera and mic**. Allow both permissions.
5. Keep the browser page in the foreground and the screen awake. Each room should show **node live** on the laptop;
   the camera cards should update once per second. These are periodically refreshed still images, not full-motion video.
6. Tap **Stop** to release the camera and microphone. The corresponding room and preview should go offline.

Each browser page gets its own node ID, even if two phones scan the same room code. A Wi-Fi disconnect triggers
reconnection using the same page ID. If a phone locks or suspends the browser, return to the page; stop/start if needed.

Previews are optional and off by default. They are forwarded to connected dashboard browsers and are not written to
memory, disk, or Databricks. Turn off `LUMEN_DEMO_PREVIEW` and restart the brain after the camera demo.
Only share the demo tunnel link with your team while previews are enabled.

If the mic permission is denied, allow it in the browser's site settings and tap Start again. If camera/pose loading
fails, the error appears on the phone and an already connected mic continues. Stop and retry to restart the camera.
If the room is live but its camera card never appears, check the preview checkbox and the brain environment setting.
No USB debugging or cable is required for this browser setup.

Hardware acceptance checks: three simultaneous previews; same-room phones; stop/restart; camera permission denial;
Wi-Fi interruption/reconnect; foreground return after screen lock; alert reaching `/strobe` while previews run.
These checks must be performed on the actual phones; automated tests do not establish hardware compatibility.

## Control center (laptop)

The dashboard's Live tab is the control center: the main camera in the middle and one camera on each side.
Click a side camera, or press **1** (left) / **2** (right), to swap it into the main view; each tile's menu picks
any phone or laptop camera. The layout is remembered in that browser.

- **Laptop cameras** (built-in webcam, USB webcams): tap **Use laptop cameras** once to allow access. A newly
  plugged-in webcam shows up in the menus by itself. Laptop camera video plays in the laptop browser only and is
  never sent to the brain.
- **Headset wearer (bottom left)**: point a laptop webcam at the person in the headset and tap **Start**. Their
  pose is copied onto a 3D figure; body tracking runs in the laptop browser and nothing is sent anywhere. Upper body
  is enough; legs follow only when the camera can see them.
- **Your own figure**: in Blender, rig the character with Mixamo bone names (or start from a Mixamo download),
  then File > Export > glTF 2.0 (.glb) and save it as `web/public/models/avatar.glb`. An `idle` animation in the
  file is used when nobody is tracked. Without the file, the walker figure is shown, dressed like our headset wearer (`web/src/lib/outfit.js`: hair, headset, shirt over tee, lanyard, watch, jeans, sneakers).
