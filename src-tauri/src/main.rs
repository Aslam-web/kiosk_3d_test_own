// Prevent a console window from popping up behind the app on Windows release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ─────────────────────────────────────────────────────────────────────────
    // On Windows, the WebView2 runtime would normally prompt the user to
    // "Allow camera access?" every launch. For a kiosk that's unacceptable,
    // so we pass Chromium flags that auto-accept the prompt:
    //
    //   --use-fake-ui-for-media-stream   →  getUserMedia() no longer prompts
    //   --autoplay-policy=no-user-gesture-required
    //                                    →  videos can autoplay without click
    //
    // WebView2 reads these from the env var Microsoft defined for exactly
    // this purpose. Setting it before Tauri spawns the webview is enough.
    //
    // On other platforms the variable is simply ignored.
    // ─────────────────────────────────────────────────────────────────────────
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required",
        );
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the fishtank-vr app");
}
