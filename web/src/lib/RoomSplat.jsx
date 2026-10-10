import { DropInViewer, SceneRevealMode } from '@mkkellogg/gaussian-splats-3d'
import { useEffect, useState } from 'react'

// The Room view's backdrop: a Gaussian splat scan of a real room, drawn inside WalkScene's canvas
// so the figure, cameras' cones and detected things sit in it. Which file and how it lines up
// live in public/splats/room.json (see the README there). This file loads only when Room is on.
const DIR = `${import.meta.env.BASE_URL}splats/`

export default function RoomSplat({ onFail }) {
  const [viewer, setViewer] = useState(null)
  useEffect(() => {
    // Phone-friendly settings: sort on the CPU worker without SharedArrayBuffer (the tunnel doesn't
    // send the headers it needs), no view-dependent color.
    const v = new DropInViewer({ sharedMemoryForWorkers: false, gpuAcceleratedSort: false, sphericalHarmonicsDegree: 0, sceneRevealMode: SceneRevealMode.Instant })
    let dead = false
    setViewer(v)
    fetch(`${DIR}room.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`room.json ${r.status}`))))
      .then(async (cfg) => {
        // Check the scan is really there first: a missing file comes back as the web page itself,
        // and the splat loader then crashes without telling us.
        const head = await fetch(DIR + cfg.file, { method: 'HEAD' })
        if (!head.ok || /html/.test(head.headers.get('content-type') || '')) throw new Error(`no scan at ${cfg.file}`)
        if (dead) return
        const s = cfg.scale ?? 1
        return v.addSplatScene(DIR + cfg.file, {
          showLoadingUI: false, position: cfg.position, rotation: cfg.rotation, scale: [s, s, s],
        })
      })
      .catch((e) => { if (!dead) onFail(e) })
    return () => { dead = true; v.dispose().catch(() => {}) }
  }, [onFail])
  return viewer && <primitive object={viewer} />
}
