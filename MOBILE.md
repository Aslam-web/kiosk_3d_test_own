# Testing on a phone

The app works on mobile browsers, but getting it **onto** a phone needs one
extra step: mobile Safari and Chrome refuse `getUserMedia` over plain
`http://`, so you can't just hit your laptop's IP address. You need the
page served over `https://`.

## Quickest path — Cloudflare Quick Tunnel

This creates a temporary `https://*.trycloudflare.com` URL, no account
needed.

1. Install `cloudflared` once:

       # Windows
       winget install Cloudflare.cloudflared
       # macOS
       brew install cloudflared
       # Linux or manual: https://github.com/cloudflare/cloudflared/releases

2. From the project root:

       npm run fetch    # if you haven't already
       npm run tunnel

3. Watch the console for a line like:

       [cf]  Your quick Tunnel has been created! Visit it at:
       [cf]  https://something-adjective-random.trycloudflare.com

4. Open that URL on your phone. Grant camera access — the self-view shows
   up top-right, parallax kicks in.

Quit the terminal (Ctrl+C) to tear both the server and the tunnel down.

## Alternatives

- **GitHub Pages (recommended for sharing)** — the repo ships a workflow at
  `.github/workflows/deploy.yml` that runs `npm ci && npm run fetch` and
  publishes `src/` to Pages on every push to main/master. The resulting
  URL is stable, HTTPS, and doesn't need any machine to stay running.
  First-time only: **Repo → Settings → Pages → Source = "GitHub Actions"**,
  then either push or hit *Run workflow* on the Actions tab. The URL ends
  up at `https://<owner>.github.io/<repo>/`.
- **ngrok** — `ngrok http 8000`. Requires a free account + token; free tier
  URL is random per session, paid tier pins a subdomain.
- **Tailscale Serve** — `tailscale serve --bg --https=443 http://localhost:8080`
  if you and the phone are both on a tailnet. Stable URL, private.
- **drag-drop static hosts** — `src/` is pure static, so once `npm run fetch`
  has populated `src/vendor/` locally you can also drag that folder onto
  Vercel, Netlify, or Cloudflare Pages.

## What the three head-source options do

The boot card and the mobile menu (☰ bottom-right) both let you pick:

| Source           | Best on              | Notes |
| ---------------- | -------------------- | ----- |
| **Webcam**       | Desktop, Mac, iPad   | Most accurate. Needs HTTPS on mobile (see above) and enough CPU to run MediaPipe. |
| **Device tilt**  | Phone, tablet        | No permissions on Android. iOS 13+ shows one permission prompt the first time. No CPU cost, no camera — recommended mobile default. |
| **Pointer / touch** | Anything          | Move mouse or drag finger to simulate head movement. Good for quick demos or when both other options fail. |

## Known mobile quirks

- **iOS device-orientation prompt** — fires the first time the user taps
  *Use device tilt*. If they decline, the boot card stays up with an error.
- **MediaPipe GPU delegate on Android** — varies by chipset. The app
  detects a GPU-delegate failure and retries on CPU automatically. Expect
  15–25 fps on CPU vs 30+ on GPU.
- **Safari fullscreen** — requires user gesture, so *Toggle fullscreen*
  in the menu works but programmatic fullscreen from boot does not.
- **Viewport resize** — iOS Safari's URL bar collapses on scroll, which
  used to resize the canvas mid-scene. CSS is now using `100dvh`/`100svh`
  so this is a no-op; falls back to `100vh` on older browsers.
- **Landscape vs portrait** — the peeking axes follow the visible screen,
  not the phone's physical edges. Rotate the phone and "tilt the top edge
  away" keeps meaning "look up" either way. Because the user's neutral
  hold has very different raw gamma/beta in landscape vs portrait, the
  tilt origin auto-recentres on rotation — so the scene doesn't snap to
  a corner the instant you turn the phone. Hit *Recentre origin* any time
  the neutral pose drifts.
- **Battery** — running the full face-tracker pipeline is expensive on
  phones. For prolonged sessions, *Device tilt* is much kinder.

## Lighting + positioning tips

- Webcam mode needs the user's face clearly lit. Backlighting (window
  behind you) kills accuracy fast.
- Tilt mode: hold the phone at your natural reading angle and hit
  *Recentre origin* in the menu. That becomes the neutral pose.
