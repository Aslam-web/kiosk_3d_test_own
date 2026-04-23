# FishtankVR — handoff for a fresh Claude session

A head-tracked 3D kiosk prototype. Move your head, the scene moves with
you — like peeking through a window. Ships as a static site on GitHub
Pages and as a Windows `.exe` via Tauri. Repo root: `kiosk_3d/`.

This doc is ground truth for future sessions: what we decided, what's
weird, what's pending. Keep it accurate as the repo evolves.

## Tech stack — what, and why this stack

- **Webcam → [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)** (WASM, on-device, no cloud) → 3D head position.
- **[Three.js](https://threejs.org/) r128 via importmap** with camera-translation parallax. We shift the scene camera, we don't rotate a head rig.
- **[Tauri 2](https://tauri.app) + WebView2** for the Windows desktop shell.
- **Pure vanilla HTML/CSS/JS** in `src/index.html`. No build step. No React, Vue, Vite, TypeScript. An earlier Vite+TS scaffold lives in `_archive/` and was abandoned after we pivoted to a minimal single-file prototype (tasks #30–#34).

The "no build step" decision is load-bearing. `src/index.html` is a
self-contained page that runs both from GitHub Pages and inside the
Tauri WebView without transformation. When you're tempted to add a
bundler, reread this paragraph.

## Directory layout

```
kiosk_3d/
├── src/                          ← what GitHub Pages publishes
│   ├── index.html                ← ~1500 lines, the entire app
│   ├── KioskConfig.json               ← scene config (see Scene system below)
│   ├── manifest.webmanifest      ← PWA install metadata
│   ├── sw.js                     ← service worker (offline + update flow)
│   ├── icons/                    ← PWA icons (180/192/512/512-maskable/favicon)
│   ├── assets/                   ← user-supplied media for image-layers/models
│   └── vendor/                   ← GITIGNORED — populated by `npm run fetch`
│                                    (Three.js + MediaPipe, ~44 MB)
├── src-tauri/                    ← Rust / Tauri desktop shell
├── scripts/
│   ├── fetch-vendor.mjs          ← downloads + unpacks vendor/ from npm
│   └── tunnel.mjs                ← cloudflared wrapper for mobile testing
├── .github/workflows/deploy.yml  ← manual-trigger GitHub Pages deploy
├── _archive/                     ← abandoned Vite+TS prototype — do not touch
├── BUILD.md / MOBILE.md / README.md
└── CLAUDE.md                     ← this file
```

## Architecture decisions (the ones that shape everything else)

### Head-source abstraction — `headSource` interface
The app supports **webcam face tracking, device tilt (mobile gyro),
pointer/touch fallback, and mouse** — all behind a single interface
with `.tick()` / `.calibrate()` / `.dispose()`. Switching modes at
runtime is a swap of the object referenced by `headSource`, nothing
else in the render loop changes. When adding new input modes, conform
to that shape.

### Scene builders via a config-driven dispatcher
`src/KioskConfig.json` has a `scene.type` field with four values:

- `demo` — procedural torus-knot + floating geometry (default, no assets).
- `image-layers` — stacked 2D media planes at configurable depths.
- `model` — a single 3D model (`.glb .gltf .fbx .obj .stl`).
- `point-cloud` — a single point cloud (`.ply .pcd .xyz`).

Each builder returns `{ tick(dt), onResize() }` hooks that the render
loop drives. When adding a scene type: add a branch in the dispatcher
around line 246 of `index.html`, implement a builder that returns that
interface, document the schema in `KioskConfig.json`'s `$schema_notes`, and
add a `_examples.yourType` block so users can copy-paste.

**Shared placement helpers** — `applyPlacement()` / `applyAutoFit()` /
`defaultStudioLights()` / `extOf()` live in `index.html` around lines
1090–1151. Use them from any new scene builder; don't reinvent
fit/position/rotation math.

### Parallax strength is shared across scene types
Same slider, same mapping, all four scene types. That's deliberate —
head-tracking quality shouldn't depend on what's rendered.

### Fullscreen: three surfaces, one toggle
`toggleFullscreen()` is bound to (1) the floating `#fs-btn`,
(2) the hamburger menu's "Toggle fullscreen" entry, and (3) the **F**
keyboard shortcut. Icon + label + body class stay synced via the
`fullscreenchange` / `webkitfullscreenchange` event — never set them
imperatively from the handlers. If you add a fourth surface, wire it
into `toggleFullscreen()` and let the event do the sync.

### PWA + service worker for the iOS fullscreen problem
iPhone Safari doesn't expose the Fullscreen API on arbitrary elements
(iPad does; iPhone doesn't, even on iOS 26). Our workaround is
**install as a PWA** — `display: standalone` hides Safari chrome and
lets us lock orientation. The in-app `#ios-install` banner walks
iPhone users through Share → Add to Home Screen.

**Service worker (`src/sw.js`) caching strategy:**

- HTML, `KioskConfig.json`, `manifest.webmanifest` → **network-first** with
  cached fallback. Deploys land immediately on next launch.
- `/vendor/*`, `/assets/*`, `/icons/*` → **cache-first + stale-while-revalidate**.
  The 44 MB vendor bundle loads instantly from cache; the background
  refetch keeps cached copies fresh for next load.
- Everything else → network-first.

**Update flow**: bump `VERSION` in `sw.js` when cache shape changes. Otherwise
just deploy — the SW byte-compares on next launch, `skipWaiting()` fires,
`controllerchange` triggers the in-app "New version available — Reload"
toast. User taps Reload → `SKIP_WAITING` message → reload → they're on the
new version. No uninstall/reinstall dance.

## Non-obvious things that will bite you

### Version numbers
- **Three.js: r128** (pinned). The importmap in `index.html` resolves
  `three` and `three/addons/...` against `src/vendor/three/`. Some
  modern three.js examples use APIs that don't exist in r128 — e.g.
  **`THREE.CapsuleGeometry`** was added in r142 and won't work here.
  Use `CylinderGeometry` / `SphereGeometry` instead, or compose.
- **Decoders vendored**: DRACO, KTX2, and Meshopt decoders live under
  `src/vendor/three/addons/libs/`. They're wired up in the model loader
  — don't fetch them from a CDN.

### GitHub Pages hosting quirks
- Per-file limit: **100 MB**. Large point-cloud scans need DRACO-compressed
  PLY or external hosting (S3/R2) with the URL in `scene.src`.
- Total artifact: 1 GB.
- **Deploys are manual**: `.github/workflows/deploy.yml` runs on
  `workflow_dispatch` only. Push commits freely; don't publish until
  ready. First-time: Settings → Pages → Source = "GitHub Actions".
- The workflow runs `npm run fetch` inside the runner to populate
  `src/vendor/`, then uploads `src/` as the Pages artifact. Don't
  commit vendor/ — it's gitignored for a reason.

### Mobile / iOS platform warts
- **Chrome on iOS ≠ Chrome**. Apple forces all iOS browsers onto
  WebKit — they all inherit Safari's restrictions. Testing Safari ≈
  testing every iOS browser.
- **`document.fullscreenEnabled` is unreliable on iOS** (returns
  `undefined` even on versions that support the API). We probe
  `documentElement.requestFullscreen` / `webkitRequestFullscreen`
  directly. See the `reqFS` block in `index.html`. Don't regress this.
- **Rotation units are degrees, not radians** in `KioskConfig.json`. Easier
  to eyeball; converted in `applyPlacement()`. Mention this in every
  example.
- **`screen.orientation.lock()` only works in PWA standalone mode on
  iOS**, and only on Android Chrome regardless. We call it best-effort
  and swallow rejections.

### Sandbox / testing constraints
- Playwright's browser runs on the **user's Windows host**, not in our
  sandbox. It sees `D:/New%20Games/Vibe/kiosk_3d/...`. Can't hit
  `localhost:8000` in our sandbox from it.
- Our Bash sandbox has an **HTTPS proxy allowlist** that blocks
  localtunnel, serveo, bore.pub, raw `release-assets.githubusercontent.com`,
  etc. Abandon any plan that routes through one of those.
- When you need to test browser logic from the sandbox, use a **`data:` URL
  harness** (see `test-harness.html` precedent in `/sessions/sleepy-great-keller/`).

### Assets convention
- Asset archives (`*.zip`) are gitignored — unpacked folders next to them
  are what the app loads. `src/assets/*.zip` is in `.gitignore`.
- `src/KioskConfig.json` paths are **relative to `src/`**, not to the JSON
  file (e.g. `"assets/shibuya/bg.jpg"`).

## Conventions (enforce these)

- **File style**: 2-space indent, ES modules (`type: "module"` in package.json),
  vanilla JS with JSDoc comments where it helps. No TypeScript.
- **Comments pay for themselves**: function-level "what + why" comments
  earn their keep. The codebase is one long file — navigation depends
  on the banner comments. Preserve and extend them.
- **Async boundaries**: scene builders are `async` because KioskConfig.json
  fetch is async; keep the render loop sync.
- **No `localStorage`** for user state — we use `sessionStorage` (see
  iOS install banner dismissal). Kiosk-ish product; we don't want
  things to stick across browser restarts.
- **Degrees everywhere** for rotation in config. Radians stay internal.
- **Commit style**: terse, imperative, lowercase. Look at `git log`.

## In-progress / open work

- **#50 — Build the Windows `.exe` via Tauri** (in progress). Command:
  `npm install && npm run fetch && npm run tauri:build`. Output lands
  at `src-tauri/target/release/bundle/`. `BUILD.md` has the details.
  Confirm WiX downloads succeed on first run.

All other tasks (#1–#69) are complete. The recently-shipped features
not yet tested end-to-end on iPhone in production:

- **Pulsing fullscreen hint + iOS install banner** — landed this session,
  not yet validated via the deployed URL on an actual iPhone 11 Pro Max.
- **Service worker offline + update flow** — landed this session, not
  yet validated against a real deploy.

## Open questions

- Does the PWA install flow actually deliver working fullscreen on iOS 26
  iPhone in standalone mode? Strong expectation yes (that's Apple's
  documented path), but not yet verified on device.
- Do we want a native "Install on Android" button too? `beforeinstallprompt`
  is available but we haven't wired it. Currently Android users get the
  browser's native install UI only.
- Point-cloud files >100 MB for GitHub Pages — is external hosting
  (S3/R2) worth building a helper for, or is "DRACO your PLY and inline
  it" good enough? Not decided.

## Workflows — the commands you'll actually run

```sh
# one-time per machine
npm install
npm run fetch                     # vendors Three.js + MediaPipe (~44 MB) — required

# dev loop
npm run serve                     # http://localhost:8000
npm run serve:https               # https://localhost:8443 — needs cert.pem/key.pem
npm run tunnel                    # https://*.trycloudflare.com — share with phones

# desktop build
npm run tauri:dev                 # live Tauri window
npm run tauri:build               # Windows .msi/.exe installer

# deploy
git push                          # pushes only, does not deploy
# then Actions tab → "Deploy to GitHub Pages" → Run workflow
```

## What not to do

- **Don't replace the single-file vanilla JS architecture with a bundler.**
  If you feel the pain enough to bundle, revisit the abandoned `_archive/`
  first and understand why it was abandoned.
- **Don't commit `src/vendor/`**. It's huge and gitignored. The deploy
  workflow repopulates it.
- **Don't push to master expecting the site to update.** Deploys are
  manual on purpose (keeps WIP commits invisible from the live site).
- **Don't call `THREE.CapsuleGeometry`** (see Three.js r128 note).
- **Don't gate the fullscreen button on `document.fullscreenEnabled`**.
  It fails on iOS. Probe the element's `requestFullscreen` method.
- **Don't forget to bump `VERSION` in `sw.js`** when you change the
  cache shape or invalidate cached shell entries. Otherwise users will
  be stuck on the old version forever.
