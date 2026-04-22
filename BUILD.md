# Building the FishtankVR desktop app

End result: a single `FishtankVR-0.1.0-x64.msi` (or `.exe` installer) of
around **8–12 MB**, working fully offline.

## One-time prerequisites (Windows)

1. **Node.js 18+** — https://nodejs.org (you already have it from the old Vite setup).
2. **Rust (stable) + Cargo** — install via <https://rustup.rs>.
   After install, in a *new* terminal verify:

       rustc --version    # → rustc 1.81+ or newer
       cargo --version

3. **Microsoft WebView2 runtime** — Windows 10/11 typically ships it; on
   older 10 images install from
   <https://developer.microsoft.com/microsoft-edge/webview2/>.
4. **Microsoft C++ Build Tools** — install "Desktop development with C++"
   from <https://visualstudio.microsoft.com/visual-cpp-build-tools/>.
   Required because Tauri's linker runs through MSVC.
5. **Tauri CLI** — installed automatically the first time you run `npm install`
   (it's in `package.json`'s `devDependencies`).

## Build steps

From the project root:

    # 1. Install Tauri CLI (once)
    npm install

    # 2. Vendor Three.js + MediaPipe into src/vendor/ (needs internet).
    #    Safe to re-run; overwrites the folder.
    npm run fetch

    # 3. Build the production .exe + .msi installer
    npm run tauri:build

Icons come with placeholders baked in at `src-tauri/icons/*` — the build
works out of the box. To replace with a real brand asset, drop a square
1024×1024 PNG at `./app-icon.png` and run:

    cd src-tauri && npx tauri icon ../app-icon.png && cd ..

That regenerates every size (PNGs + .ico) from your source. Re-run
`npm run tauri:build` afterwards.

The installer lands at:

    src-tauri/target/release/bundle/msi/FishtankVR_0.1.0_x64_en-US.msi
    src-tauri/target/release/bundle/nsis/FishtankVR_0.1.0_x64-setup.exe

The raw .exe (without installer) is at:

    src-tauri/target/release/fishtank-vr.exe

Ship either the installer (recommended for handoff) or the raw .exe +
WebView2 runtime (fully portable, slightly jankier).

## Dev loop (hot-reload)

    npm run tauri:dev

This opens the desktop window and reloads on edits to `src/index.html`.
Camera access works inside the dev window too — no HTTP-server step
needed.

## Kiosk mode

To make the app launch fullscreen with no title bar, edit
`src-tauri/tauri.conf.json` and change:

    "fullscreen": false,
    "decorations": true,

to:

    "fullscreen": true,
    "decorations": false,

Then rebuild. If you want a runtime toggle instead, press F11 in the
webview — it's the default shortcut.

## Under the hood

- **Auto-accepts webcam prompts** — `src-tauri/src/main.rs` sets
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--use-fake-ui-for-media-stream`
  before Tauri starts the webview. No "Allow camera?" dialog on boot.
- **Content Security Policy** — locked to `self` in `tauri.conf.json`.
  The app cannot reach the internet at runtime; `npm run fetch` is the
  only step that pulls from the network.
- **Offline-first** — every runtime dependency (Three.js, MediaPipe
  WASM, face landmarker model) lives under `src/vendor/` and is loaded
  through the `tauri://` custom protocol.

## What I'd do next

- **Code signing** — Windows SmartScreen will warn on every install until
  the .exe is signed with an EV cert. For a private kiosk this is fine;
  for public distribution it isn't.
- **Auto-update channel** — Tauri has a first-party updater plugin; wire
  it up when there's a second version to ship.
- **Model size trade-off** — the face landmarker `float16` model is
  ~3.7 MB. The `int8` variant is ~1 MB with slightly less smooth output.
  Swap in `fetch-vendor.mjs` if size matters.
