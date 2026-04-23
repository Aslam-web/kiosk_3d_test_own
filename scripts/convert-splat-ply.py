#!/usr/bin/env python3
"""Convert 3D Gaussian Splat PLYs -> standard RGB point-cloud PLYs.

The SHARP model (and most 3DGS tools) export PLYs with these vertex props:
    x, y, z, f_dc_0, f_dc_1, f_dc_2, opacity,
    scale_0..2, rot_0..3      (14 float32 per vertex = 56 bytes)

Standard PLY viewers (Three.js PLYLoader, MeshLab, Blender, etc.) don't
know what f_dc_* means, so the cloud renders white. This script decodes
f_dc_* -> RGB using the SH-DC formula and writes a new PLY with the
conventional `red`/`green`/`blue` uchar properties (15 bytes/vertex).

Also drops very-low-opacity points (`sigmoid(opacity) < OPACITY_MIN`) —
splat exports typically contain a lot of near-invisible "fluff"
gaussians that look awful when rendered as opaque discs.

Usage: python scripts/convert-splat-ply.py
       (processes every *.ply in src/assets/, backs originals up to
        src/assets/_originals/)
"""
from __future__ import annotations

import shutil
import struct
import sys
from pathlib import Path

import numpy as np

# SH_C0 is the 0-order spherical-harmonic basis constant. Multiplying the
# DC coefficient by it and offsetting by 0.5 gives the base-colour RGB
# that the 3DGS paper's rasterizer would render at a head-on view.
SH_C0 = 0.28209479177387814

# Threshold on sigmoid(opacity). 3DGS stores opacity as a pre-sigmoid
# logit; splats with sigmoid below ~0.1 are visually noise. Lower this
# to 0 if you want to keep everything (file will be ~10× larger).
OPACITY_MIN = 0.1

EXPECTED_PROPS = [
    'x', 'y', 'z',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    'opacity',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3',
]


def read_splat_ply(path: Path):
    """Parse a SHARP/3DGS binary-LE PLY. Returns (vertex_count, ndarray Nx14)."""
    with path.open('rb') as f:
        # Header is ASCII, terminated by "end_header\n".
        header_bytes = bytearray()
        while not header_bytes.endswith(b'end_header\n'):
            chunk = f.read(1)
            if not chunk:
                raise ValueError(f'{path.name}: header never ended')
            header_bytes += chunk
        header = header_bytes.decode('ascii')

        if 'format binary_little_endian' not in header:
            raise ValueError(f'{path.name}: not binary little-endian PLY')

        # Extract vertex count + property order from the header.
        vcount = None
        props = []
        for line in header.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == 'element' and parts[1] == 'vertex':
                vcount = int(parts[2])
            elif len(parts) >= 3 and parts[0] == 'property':
                if parts[1] != 'float':
                    raise ValueError(
                        f'{path.name}: unexpected non-float property {parts[2]}'
                    )
                props.append(parts[2])
        if vcount is None:
            raise ValueError(f'{path.name}: no vertex element')
        if props != EXPECTED_PROPS:
            raise ValueError(
                f'{path.name}: property layout mismatch\n'
                f'  expected: {EXPECTED_PROPS}\n'
                f'  got:      {props}'
            )

        body = f.read(vcount * 14 * 4)
        if len(body) != vcount * 14 * 4:
            raise ValueError(f'{path.name}: truncated body')

    verts = np.frombuffer(body, dtype='<f4').reshape(vcount, 14)
    return vcount, verts


def decode_colour(f_dc: np.ndarray) -> np.ndarray:
    """SH-DC coefficients -> RGB bytes. f_dc: (N, 3) float -> (N, 3) uint8."""
    rgb = 0.5 + SH_C0 * f_dc
    return np.clip(rgb * 255, 0, 255).astype(np.uint8)


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def write_rgb_ply(path: Path, xyz: np.ndarray, rgb: np.ndarray) -> None:
    """Write a standard binary_little_endian PLY with xyz + red/green/blue."""
    n = xyz.shape[0]
    header = (
        'ply\n'
        'format binary_little_endian 1.0\n'
        'comment converted from 3DGS by convert-splat-ply.py\n'
        f'element vertex {n}\n'
        'property float x\n'
        'property float y\n'
        'property float z\n'
        'property uchar red\n'
        'property uchar green\n'
        'property uchar blue\n'
        'end_header\n'
    ).encode('ascii')

    # Interleave: each vertex is 3 f4 + 3 u1 = 15 bytes.
    record = np.empty(n, dtype=[
        ('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
        ('r', 'u1'), ('g', 'u1'), ('b', 'u1'),
    ])
    record['x'] = xyz[:, 0]
    record['y'] = xyz[:, 1]
    record['z'] = xyz[:, 2]
    record['r'] = rgb[:, 0]
    record['g'] = rgb[:, 1]
    record['b'] = rgb[:, 2]

    with path.open('wb') as f:
        f.write(header)
        record.tofile(f)


def convert(src_path: Path, dst_path: Path) -> tuple[int, int]:
    vcount, verts = read_splat_ply(src_path)
    xyz = verts[:, 0:3]
    f_dc = verts[:, 3:6]
    opacity = verts[:, 6]

    # Filter out near-transparent splats — they render as visible noise
    # when drawn as opaque points.
    keep = sigmoid(opacity) >= OPACITY_MIN
    xyz = xyz[keep]
    f_dc = f_dc[keep]

    rgb = decode_colour(f_dc)
    write_rgb_ply(dst_path, xyz, rgb)
    return vcount, int(keep.sum())


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    assets = root / 'src' / 'assets'
    backup = assets / '_originals'

    plys = sorted(p for p in assets.glob('*.ply') if p.is_file())
    if not plys:
        print(f'No .ply files found in {assets}', file=sys.stderr)
        return 1

    backup.mkdir(exist_ok=True)
    print(f'Processing {len(plys)} file(s) in {assets}\n'
          f'Backups   -> {backup}\n'
          f'Opacity threshold: sigmoid(opacity) >= {OPACITY_MIN}\n')

    for src in plys:
        bak = backup / src.name
        if not bak.exists():
            shutil.copy2(src, bak)
            backup_note = 'backed up'
        else:
            backup_note = 'backup already exists'

        # Read from the backup every time so re-running is idempotent
        # (the backup is the ground truth).
        try:
            orig_count, kept = convert(bak, src)
        except Exception as e:
            print(f'  [fail] {src.name}: {e}')
            continue

        orig_size_mb = bak.stat().st_size / (1024 * 1024)
        new_size_mb = src.stat().st_size / (1024 * 1024)
        pct_kept = 100 * kept / orig_count if orig_count else 0
        print(f'  [ok] {src.name}  ({backup_note})\n'
              f'      {orig_count:,} splats -> {kept:,} points '
              f'({pct_kept:.1f}% kept)\n'
              f'      {orig_size_mb:.1f} MB -> {new_size_mb:.1f} MB')

    return 0


if __name__ == '__main__':
    sys.exit(main())
