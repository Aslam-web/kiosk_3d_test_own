/**
 * tunnel.mjs
 * ----------
 * Exposes the local dev server over HTTPS via Cloudflare Quick Tunnels so
 * phones on any network can open it. Mobile browsers require HTTPS for
 * getUserMedia, so this is the fastest path to phone-side testing.
 *
 * Flow:
 *   1. Resolve the `cloudflared` binary (PATH → common install locations).
 *   2. Start a static file server on :8000 for ../src using Node's built-in
 *      http.server — no npm network round-trip, no `npx serve` first-run
 *      delay, no install failures that can orphan the tunnel.
 *   3. Wait until :8000 responds before asking cloudflared to publish.
 *   4. Run cloudflared, watch its stderr for the trycloudflare.com URL, and
 *      reprint it in a BIG, IMPOSSIBLE-TO-MISS banner when detected.
 *   5. If the static server ever dies, the tunnel ALSO dies, but we don't
 *      tear things down on serve exit alone if cloudflared is still healthy —
 *      we only exit on cloudflared's exit. That prevents the "orphaned URL"
 *      Cloudflare-1033 class of bugs.
 *
 * Install cloudflared once:
 *   Windows:  winget install Cloudflare.cloudflared    (then reopen terminal)
 *   macOS  :  brew install cloudflared
 *   Linux  :  https://github.com/cloudflare/cloudflared/releases
 *
 * Ctrl+C to shut down both.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import process from 'node:process';

// Preferred port first. Windows commonly reserves random port chunks when
// Hyper-V / WSL2 networking is enabled, so listen() may fail with EACCES on
// the usual suspects (8000, 8080). We fall back through a list until one
// works. Override with `PORT=1234 npm run tunnel` if you have a specific one.
const PORT_CANDIDATES = process.env.PORT
  ? [Number(process.env.PORT)]
  : [8000, 8080, 5173, 3000, 4173, 8765, 9000, 7777];
const HERE   = fileURLToPath(new URL('.', import.meta.url));
const WEBROOT = resolve(HERE, '..', 'src');

function log(...a) { console.log('[tunnel]', ...a); }

// ─── Locate cloudflared ────────────────────────────────────────────────────
function resolveCloudflared() {
  const probe = spawnSync('cloudflared', ['--version'], { shell: true });
  if (probe.status === 0) return 'cloudflared';
  const candidates = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

// ─── Inline static file server ─────────────────────────────────────────────
// Previously we used `npx serve` which (a) needs an npm fetch on first run,
// (b) silently fails on Windows if the port is busy. A 40-line Node server
// is more reliable and has zero external deps.
const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':  'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
  '.wasm':'application/wasm',
  '.task':'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8'
};

function buildServer() {
  if (!existsSync(WEBROOT)) {
    console.error(`[tunnel] webroot does not exist: ${WEBROOT}`);
    process.exit(1);
  }
  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      // Strip leading slash, resolve, then re-verify the resolved path is
      // still inside WEBROOT (path-traversal guard — cheap but worth it).
      let fs = normalize(join(WEBROOT, urlPath));
      if (!fs.startsWith(WEBROOT)) { res.writeHead(403); return res.end('403'); }
      if (existsSync(fs) && statSync(fs).isDirectory()) fs = join(fs, 'index.html');
      if (!existsSync(fs)) { res.writeHead(404); return res.end('404'); }
      const type = MIME[extname(fs).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': statSync(fs).size,
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      createReadStream(fs).pipe(res);
    } catch (err) {
      console.error('[tunnel.serve] 500:', err);
      res.writeHead(500); res.end('500');
    }
  });
}

/**
 * Listen on the first port from the candidate list that actually works.
 * On Windows, `EACCES` on a non-privileged port almost always means Hyper-V
 * or WSL2's networking has reserved that port range — the fix is to skip
 * the port, not to request elevation.
 */
async function listenOnAnyPort(server, candidates) {
  const errors = [];
  for (const port of candidates) {
    try {
      await new Promise((ok, fail) => {
        const onErr = (err) => { server.off('listening', onOk); fail(err); };
        const onOk  = () => { server.off('error', onErr); ok(); };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(port, '127.0.0.1');
      });
      return port;
    } catch (err) {
      errors.push({ port, code: err.code, msg: err.message });
      if (err.code === 'EACCES') {
        log(`:${port} blocked (EACCES — reserved by the OS, often Hyper-V on Windows) — trying next`);
      } else if (err.code === 'EADDRINUSE') {
        log(`:${port} already in use — trying next`);
      } else {
        log(`:${port} failed (${err.code ?? 'unknown'}) — trying next`);
      }
      // listen() leaves the server in a dirty state after an error; close() before retry.
      try { server.close(); } catch {}
    }
  }
  const msg = 'no port could be bound. Tried: ' +
    errors.map(e => `:${e.port}(${e.code})`).join(', ');
  throw new Error(msg);
}

function windowsPortReservationHint() {
  if (process.platform !== 'win32') return '';
  return [
    '',
    '  Windows-specific hint: EACCES on 127.0.0.1 usually means Hyper-V / WSL2',
    '  has reserved that port range. See what\'s excluded with:',
    '      netsh interface ipv4 show excludedportrange protocol=tcp',
    '  (run in an elevated PowerShell for the full picture)',
    ''
  ].join('\n');
}

// ─── Wait until server is actually answering ───────────────────────────────
async function waitUntilUp(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((done) => {
      http.get(url, (res) => { res.resume(); done(res.statusCode === 200); })
          .on('error', () => done(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// ─── Pretty banner for the public URL ──────────────────────────────────────
function bannerFor(url) {
  const line = '═'.repeat(url.length + 8);
  return [
    '',
    '  ╔' + line + '╗',
    '  ║    ' + url + '    ║',
    '  ╚' + line + '╝',
    '  ↑ Open this on your phone. Keep THIS terminal open — closing it',
    '    tears down the tunnel and the URL stops working (error 1033).',
    ''
  ].join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const CLOUDFLARED = resolveCloudflared();
  if (!CLOUDFLARED) {
    console.error('[tunnel] cloudflared not found.\n');
    console.error('  Install once:');
    console.error('    Windows:  winget install Cloudflare.cloudflared');
    console.error('              ^^ then CLOSE and REOPEN your terminal');
    console.error('    macOS  :  brew install cloudflared');
    console.error('    other  :  https://github.com/cloudflare/cloudflared/releases\n');
    process.exit(1);
  }
  log('using cloudflared at:', CLOUDFLARED);

  // 1. Local server first — has to be up before the tunnel connects.
  const server = buildServer();
  let port;
  try {
    port = await listenOnAnyPort(server, PORT_CANDIDATES);
  } catch (err) {
    console.error('[tunnel]', err.message);
    console.error(windowsPortReservationHint());
    process.exit(1);
  }
  log(`static server listening at http://127.0.0.1:${port}  (root: ${WEBROOT})`);

  const ok = await waitUntilUp(`http://127.0.0.1:${port}/`, 5000);
  if (!ok) {
    console.error(`[tunnel] local server did not respond on :${port}`);
    process.exit(1);
  }
  log('local server is responding — starting tunnel');

  // 2. Spawn cloudflared. Its URL goes to stderr, not stdout.
  //
  // Flags chosen deliberately:
  //   --protocol http2        Skip QUIC (UDP/7844). QUIC frequently fails on
  //                           corporate / hotel / carrier-NAT networks that
  //                           drop UDP, and also on machines where Tailscale
  //                           or other VPNs steal the outbound route. HTTP/2
  //                           over TCP/443 goes through almost anything.
  //   --edge-ip-version 4     Force IPv4. Tailscale advertises an IPv6 that
  //                           Cloudflare's edge sometimes picks first, then
  //                           dies because that ULA isn't globally routable.
  //
  // If you actually want QUIC (slightly faster), set CF_PROTOCOL=quic.
  const useShell = !CLOUDFLARED.includes('\\') && !CLOUDFLARED.includes('/');
  const protocol = process.env.CF_PROTOCOL || 'http2';
  const cfArgs = [
    'tunnel',
    '--url', `http://localhost:${port}`,
    '--protocol', protocol,
    '--edge-ip-version', '4',
  ];
  log(`spawning cloudflared (protocol=${protocol}, edge=ipv4)`);
  const cf = spawn(CLOUDFLARED, cfArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
  });

  let announcedUrl = null;
  const URL_RE = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i;

  function scanForUrl(chunk) {
    if (announcedUrl) return;
    const m = chunk.toString().match(URL_RE);
    if (m) {
      announcedUrl = m[0];
      process.stdout.write(bannerFor(announcedUrl));
    }
  }

  cf.stdout.on('data', (d) => { process.stdout.write(`[cf] ${d}`); scanForUrl(d); });
  cf.stderr.on('data', (d) => { process.stderr.write(`[cf] ${d}`); scanForUrl(d); });

  cf.on('error', (err) => {
    console.error('[tunnel] cloudflared failed to spawn:', err.message);
    server.close(); process.exit(1);
  });

  cf.on('exit', (code) => {
    // cloudflared is the authoritative death signal — when it dies, so do we.
    log(`cloudflared exited (code ${code ?? 'null'})`);
    server.close();
    process.exit(code ?? 1);
  });

  // 3. Clean shutdown on Ctrl+C.
  const shutdown = () => {
    log('shutting down');
    try { cf.kill(); } catch {}
    try { server.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // 4. Nag: if cloudflared hasn't printed a URL after 25s, warn the user —
  // this almost always means a transient network issue on their side.
  setTimeout(() => {
    if (!announcedUrl) {
      console.warn('[tunnel] still no trycloudflare.com URL after 25s.');
      console.warn('        Check your internet, retry, or try `ngrok http 8000` instead.');
    }
  }, 25_000);
}

main().catch((err) => {
  console.error('[tunnel] FAILED:', err);
  process.exit(1);
});
