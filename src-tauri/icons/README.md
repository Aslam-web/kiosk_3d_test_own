# Icons

Tauri expects these files here:

    icons/32x32.png
    icons/128x128.png
    icons/128x128@2x.png
    icons/icon.icns
    icons/icon.ico

The fastest way to generate all of them: drop a single **1024×1024 PNG** into
the project root as `app-icon.png`, then run once from `src-tauri/`:

    cargo tauri icon ../app-icon.png

That command fills this folder automatically. Until it's been run, `tauri build`
will fail with "icon not found" — this is expected.
