/**
 * fetch-vendor.mjs
 * ----------------
 * Vendors every runtime dependency into src/vendor/ so the desktop bundle
 * works offline.
 *
 * What gets downloaded:
 *   - three@0.160.0             → src/vendor/three/...
 *   - @mediapipe/tasks-vision   → src/vendor/mediapipe/...
 *   - face_landmarker.task      → src/vendor/mediapipe/models/
 *
 * Strategy: invoke `npm pack` to grab the tarballs (no need for a full
 * `npm install` of transitive deps), extract the files we actually load,
 * then curl the model file from Google's mediapipe-models CDN.
 */

import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import * as https from 'node:https';

const HERE     = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(HERE, '..');
const VENDOR   = join(ROOT, 'src', 'vendor');
const TMP      = join(ROOT, '.vendor-tmp');

const THREE_VERSION    = '0.160.0';
const MEDIAPIPE_VERSION = '0.10.9';
const MODEL_URL         =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

function log(...a) { console.log('[fetch-vendor]', ...a); }

function fresh(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function cpDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    const st  = statSync(src);
    if (st.isDirectory()) cpDir(src, dst);
    else                   copyFileSync(src, dst);
  }
}

async function download(url, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  log('download', url, '→', destPath);
  await new Promise((resolvePromise, reject) => {
    const go = (u, redirects) => {
      https.get(u, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          if (redirects > 5) return reject(new Error('too many redirects'));
          return go(new URL(res.headers.location, u).toString(), redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        pipeline(res, createWriteStream(destPath)).then(resolvePromise, reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

function pack(spec, cwd) {
  log('npm pack', spec);
  const out = execSync(`npm pack ${spec} --silent`, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const tgz = out[out.length - 1];
  execSync(`tar -xzf ${JSON.stringify(tgz)}`, { cwd });
  return join(cwd, 'package');
}

async function main() {
  fresh(VENDOR);
  fresh(TMP);

  // ── three.js ──────────────────────────────────────────────────────────────
  {
    const threeDir = join(TMP, 'three');
    fresh(threeDir);
    const pkg = pack(`three@${THREE_VERSION}`, threeDir);
    const dest = join(VENDOR, 'three');
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(pkg, 'build', 'three.module.js'), join(dest, 'three.module.js'));
    // Also vendor the addons folder so OrbitControls etc. are available if
    // the app ever reaches for them.
    cpDir(join(pkg, 'examples', 'jsm'), join(dest, 'addons'));
    log('three.js vendored');
  }

  // ── @mediapipe/tasks-vision ───────────────────────────────────────────────
  // We need: vision_bundle.mjs + the whole wasm/ folder. The npm package
  // ships both. Different releases have shuffled filenames around, so we copy
  // broadly and trust the runtime resolver to find what it needs.
  {
    const mpDir = join(TMP, 'mediapipe');
    fresh(mpDir);
    const pkg = pack(`@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`, mpDir);
    const dest = join(VENDOR, 'mediapipe');
    mkdirSync(dest, { recursive: true });

    // Top-level bundle the app imports directly.
    copyFileSync(join(pkg, 'vision_bundle.mjs'), join(dest, 'vision_bundle.mjs'));
    // Copy companion vision_bundle.js and .d.ts if present (harmless if not).
    for (const sidecar of ['vision_bundle.js', 'vision_bundle.mjs.map', 'vision_bundle.d.ts']) {
      const p = join(pkg, sidecar);
      if (existsSync(p)) copyFileSync(p, join(dest, sidecar));
    }

    // WASM folder — copy whole thing.
    const wasmSrc = join(pkg, 'wasm');
    if (!existsSync(wasmSrc)) {
      throw new Error(`@mediapipe/tasks-vision: wasm/ folder missing in tarball — package layout changed?`);
    }
    cpDir(wasmSrc, join(dest, 'wasm'));
    log('mediapipe tasks-vision vendored');
  }

  // ── face_landmarker model ─────────────────────────────────────────────────
  {
    const modelDir = join(VENDOR, 'mediapipe', 'models');
    await download(MODEL_URL, join(modelDir, 'face_landmarker.task'));
    log('face_landmarker model vendored');
  }

  // ── cleanup ───────────────────────────────────────────────────────────────
  rmSync(TMP, { recursive: true, force: true });

  // ── summary ───────────────────────────────────────────────────────────────
  let total = 0;
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else                   total += st.size;
    }
  })(VENDOR);
  log(`done — vendor/ is ${(total / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error('[fetch-vendor] FAILED:', err);
  process.exit(1);
});
