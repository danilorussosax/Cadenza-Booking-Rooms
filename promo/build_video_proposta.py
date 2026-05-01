#!/usr/bin/env python3
"""Build cadenza_proposta.mp4 from slides_proposta/*.png (18 slide)."""

import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SLIDES_DIR = os.path.join(ROOT, "slides_proposta")
OUT_PATH = os.path.join(ROOT, "cadenza_proposta.mp4")
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg")

DURATION = 8.0
XFADE = 0.5
FPS = 30
W, H = 1920, 1080


def main():
    if not os.path.exists(FFMPEG):
        print(f"ffmpeg not found at {FFMPEG}.", file=sys.stderr)
        sys.exit(1)

    slides = sorted(glob.glob(os.path.join(SLIDES_DIR, "slide_*.png")))
    n = len(slides)
    if n == 0:
        print("No slides found.", file=sys.stderr)
        sys.exit(1)
    print(f"Found {n} slides → {OUT_PATH}")

    cmd = [FFMPEG, "-y"]
    for s in slides:
        cmd += ["-loop", "1", "-framerate", "1", "-t", "1", "-i", s]

    d_frames = int(DURATION * FPS)
    chains = []
    for i in range(n):
        zoom_expr = f"1+0.03*on/{d_frames}" if i % 2 == 0 else f"1.03-0.03*on/{d_frames}"
        chains.append(
            f"[{i}:v]scale=2400:1350:force_original_aspect_ratio=decrease,"
            f"pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,"
            f"zoompan=z='{zoom_expr}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={d_frames}:s={W}x{H}:fps={FPS},"
            f"trim=duration={DURATION},setpts=PTS-STARTPTS,"
            f"format=yuv420p[v{i}]"
        )

    last = "v0"
    for i in range(1, n):
        offset = i * DURATION - i * XFADE
        out_label = f"x{i:02d}"
        chains.append(
            f"[{last}][v{i}]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[{out_label}]"
        )
        last = out_label

    filter_complex = ";".join(chains)
    cmd += [
        "-filter_complex", filter_complex,
        "-map", f"[{last}]",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-r", str(FPS),
        "-movflags", "+faststart",
        OUT_PATH,
    ]
    total = n * DURATION - (n - 1) * XFADE
    print(f"Target: {total:.1f}s ({n} × {DURATION}s − {n-1} × {XFADE}s xfade)")
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        print(r.stdout[-3500:])
        sys.exit(r.returncode)
    print(f"  ✓ {OUT_PATH}")


if __name__ == "__main__":
    main()
