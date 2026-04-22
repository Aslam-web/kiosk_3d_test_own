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
# Then: Repo → Actions tab → "Deploy to GitHub Pages" → "Run workflow"
# Site goes live at https://<owner>.github.io/<repo>/  in ~1-2 min
```

## Build the Windows .exe

See [BUILD.md](./BUILD.md). Short version: `npm install && npm run fetch && npm run tauri:build`.
Output is a ~10 MB `.msi`/`.exe` installer at `src-tauri/target/release/bundle/`.

## Controls

| Key | Action |
| --- | --- |
| **R** | Re-centre head origin |
| **H** | Toggle webcam self-view |
| **M** | Switch to pointer / touch fallback |
| **F11** | Toggle fullscreen (desktop build) |

Mobile: tap the **☰** button (bottom-right) for the same actions plus
live switches between webcam, device tilt, and pointer modes.

## Stack

Webcam → [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
(WASM, on-device) → [Three.js](https://threejs.org/) camera-translation
parallax. Desktop shell is [Tauri 2](https://tauri.app) (WebView2 on
Windows). Fully offline at runtime once `npm run fetch` has populated
`src/vendor/`.
