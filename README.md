# FishtankVR — head-tracked 3D kiosk

Move your head, and the 3D scene behind the screen moves to match — like
peeking through a window. Runs as a static page in any browser, or as a
Windows `.exe` for kiosk handoff.

## Test it locally

`npm run serve` is for the laptop you're working on. `npm run tunnel` prints
an `https://*.trycloudflare.com` URL any phone, tablet, or other laptop on
the internet can open — needed because mobile browsers refuse webcam +
device-orientation access over plain HTTP.

```sh
# one-time setup
npm install                                       # installs Tauri CLI (also needed for the .exe build)
npm run fetch                                     # vendors Three.js + MediaPipe (~44 MB) into src/vendor/
winget install Cloudflare.cloudflared             # required for `npm run tunnel`; brew install on macOS

# each dev session
npm run serve                                     # http://localhost:8000  — desktop browser
npm run tunnel                                    # https://*.trycloudflare.com  — any device, share with phones
```

For LAN-only HTTPS (no Cloudflare round-trip), see [MOBILE.md](./MOBILE.md).

## Deploy to GitHub Pages

Pushes don't auto-deploy. Push as often as you like, then manually trigger
a deploy when you want the live site to update — keeps work-in-progress
commits invisible to whoever's hitting the URL. First-time only:
**Repo → Settings → Pages → Source = "GitHub Actions"**.

```sh
git add .
git commit -m "your message"
git push origin master                            # pushes only, doesn't deploy
```
Then: **Repo → Actions tab → "Deploy to GitHub Pages" → "Run workflow"**
Site goes live at `https://<owner>.github.io/<repo>/`  in ~1-2 min

## Build the Windows .exe

See [BUILD.md](./BUILD.md). Short version: `npm install && npm run fetch && npm run tauri:build`.
Output is a ~10 MB `.msi`/`.exe` installer at `src-tauri/target/release/bundle/`.

## Scenes

The rendered scene is chosen by `src/KioskConfig.json`. Four types ship today:

`"demo"` (default) — the procedural floating-geometry fishtank. No assets needed.

`"image-layers"` — stacks 2D media planes at configurable depths.

`"model"` — a single 3D model (.glb .gltf .fbx .obj .stl).

`"point-cloud"` — a single point cloud (.ply .pcd .xyz).

All four share the same head-tracking parallax. Full working examples for
each type live under `_examples.*` in `src/KioskConfig.json` — copy a block into
`scene` to activate it.

### Image layers

```json
{
  "scene": {
    "type": "image-layers",
    "background": "#0a0b10",
    "layers": [
      { "id": "bg",     "src": "assets/shibuya/bg.jpg",      "anchor": "cover",                        "depth": -6.0 },
      { "id": "bridge", "src": "assets/shibuya/bridge.webp", "anchor": "top",          "widthPct": 65, "depth": -4.0 },
      { "id": "tree",   "src": "assets/shibuya/tree.webp",   "anchor": "right",        "widthPct": 25, "depth": -2.5 },
      { "id": "lady",   "src": "assets/shibuya/lady.gif",    "anchor": "left",         "widthPct": 25, "depth": -1.0 },
      { "id": "bike",   "src": "assets/shibuya/bike.webp",   "anchor": "bottom-right", "widthPct": 12, "depth": -0.4 }
    ]
  }
}
```

Drop media into `src/assets/…` and reference it by its relative path. The
loader dispatches by file extension: `.jpg .png .webp .avif` (static),
`.gif .apng` (animated via hidden `<img>` → canvas texture — the browser's
native decoder drives the animation), `.mp4 .webm .mov` (muted, looped
`<video>` → video texture). `depth` is world-space Z — more negative = farther
back = parallaxes less. `anchor` is `cover` (fills viewport, preserves aspect)
or any of `center / left / right / top / bottom / top-left / top-right /
bottom-left / bottom-right`. `widthPct` is the layer width as a percent of the
viewport width visible at that depth; height derives from the image's native
aspect ratio. Optional `offset: { x, y }` nudges in fractional viewport units
after the anchor snap.

### 3D models

```json
{
  "scene": {
    "type": "model",
    "background": "#0a0b10",
    "src": "assets/models/robot.glb",
    "fit": "auto", "fitSize": 2.0,
    "position": { "x": 0, "y": -0.2, "z": -1.0 },
    "rotation": { "x": 0, "y":  25,  "z":  0   },
    "scale": 1.0,
    "animation": "auto"
  }
}
```

Supported extensions: `.glb .gltf` (DRACO + KTX2 + Meshopt compression all
handled from the vendored decoders — fully offline), `.fbx`, `.obj`, `.stl`.
Place files under `src/assets/…`.

`fit: "auto"` centers the model on the origin and rescales so its longest
bounding-box axis equals `fitSize` (default `2.0` world units — fills the
fishtank nicely at `CAMERA_DISTANCE = 3`). Use `fit: "none"` to keep raw
file coordinates (e.g. a model already authored to scene scale). `position`
is in world units on top of the fit. `rotation` is in **degrees** (not
radians — easier to eyeball in JSON). `scale` is either a uniform number
or `{ x, y, z }`, multiplied on top of the fit.

`animation` controls glTF / FBX clip playback: `"auto"` (default) plays all
clips, `"none"` stops all, or pass a clip name string to play just that one.

A soft four-light studio rig (ambient + key + fill + rim) is added
automatically so PBR materials render correctly.

### Point clouds

```json
{
  "scene": {
    "type": "point-cloud",
    "background": "#05070c",
    "src": "assets/clouds/scan.ply",
    "fit": "auto", "fitSize": 2.4,
    "position": { "x": 0, "y": 0, "z": -1.2 },
    "rotation": { "x": -90, "y": 0, "z": 0 },
    "pointSize": 0.008,
    "useVertexColors": true,
    "pointColor": "#ffffff"
  }
}
```

Supported extensions: `.ply .pcd .xyz`. `pointSize` is world-space and obeys
perspective attenuation (points shrink with depth). `useVertexColors` is on
by default when the file has per-point colors; set it to `false` to render
everything in the solid `pointColor`. `fit / fitSize / position / rotation /
scale` work identically to the model scene.

Note on GitHub Pages hosting: the per-file limit is 100 MB — large
photogrammetry scans may need downsampling, DRACO-compressed PLY, or
external hosting (S3 / R2) with the URL in `src`.

## Controls

| Key | Action |
| --- | --- |
| **R** | Re-centre head origin |
| **H** | Toggle webcam self-view |
| **M** | Switch to pointer / touch fallback |
| **F** | Toggle fullscreen (page-level — works everywhere) |
| **F11** | Toggle fullscreen (browser-level, desktop only) |

Mobile: tap the **☰** button (bottom-right) for the same actions plus
live switches between webcam, device tilt, and pointer modes. The **⛶**
button (bottom-left) enters/exits fullscreen on mobile — on Android it
also attempts a landscape orientation lock.

## iPhone users: install as a PWA for fullscreen

iPhone Safari (and iOS Chrome, which is WebKit underneath) doesn't expose
the Fullscreen API on arbitrary elements — only iPad does. To get a real
fullscreen + landscape-locked experience on iPhone, install the page as a
home-screen web app:

1. Open the site in Safari on the iPhone.
2. Tap the **Share** button in the bottom toolbar.
3. Scroll down in the share sheet and tap **Add to Home Screen**.
4. Tap **Add** in the top right. An icon appears on the home screen.
5. Launch the app from the icon — it opens without Safari chrome, and the
   ⛶ button now works to go fully edge-to-edge and lock landscape.

The in-app prompt "For fullscreen on iPhone: tap Share → Add to Home
Screen" surfaces automatically on iPhone Safari to guide first-time
users. It's dismissable (× button) per session.

Updates reach installed instances via the service worker (`src/sw.js`).
On every deploy to GitHub Pages, the SW detects the new bundle and
surfaces a "New version available — Reload" toast inside the app. Bump
`VERSION` in `sw.js` when you want to force-purge the runtime cache
(e.g. after changing the vendor bundle).

## Stack

Webcam → [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
(WASM, on-device) → [Three.js](https://threejs.org/) camera-translation
parallax. Desktop shell is [Tauri 2](https://tauri.app) (WebView2 on
Windows). Fully offline at runtime once `npm run fetch` has populated
`src/vendor/`