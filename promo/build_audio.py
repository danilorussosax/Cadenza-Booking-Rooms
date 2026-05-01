#!/usr/bin/env python3
"""Add Italian neural voiceover (edge-tts) + royalty-free MP3 bed to
cadenza_promo.mp4."""

import asyncio
import os
import subprocess
import sys

import edge_tts

ROOT = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg")
VO_DIR = os.path.join(ROOT, "vo")
MUSIC = os.path.join(ROOT, "music", "inspired.mp3")
VIDEO_IN = os.path.join(ROOT, "cadenza_promo.mp4")
VIDEO_OUT = os.path.join(ROOT, "cadenza_promo_audio.mp4")

# Microsoft neural voice (it-IT). Sounds noticeably more natural than `say`.
VOICE = "it-IT-IsabellaNeural"
# slight slow-down for clearer narration; values like "-5%" / "+5%"
RATE = "-3%"
# subtle pitch tweak for warmth; "-2Hz" works for neural voices
PITCH = "-2Hz"

SLIDE_DUR = 9.0
XFADE = 0.6
SLIDE_ADV = SLIDE_DUR - XFADE  # 8.4s
N = 14
TOTAL = N * SLIDE_DUR - (N - 1) * XFADE  # 118.2

NARRATION = [
    "Cadenza. Il sistema di prenotazione aule pensato per il conservatorio.",
    "Aule contese. Email che si accavallano. Fogli Excel non sincronizzati.",
    "Cadenza unisce direzione, docenti e studenti in un'unica piattaforma.",
    "Prenoti in tre tap. Da web, da mobile, dall'app installabile.",
    "Zero sovrapposizioni. Garantite a livello di database, non solo nell'applicazione.",
    "Le sale concerti hanno il loro workflow di approvazione. La lista d'attesa promuove in automatico.",
    "Inventario strumenti completo. PDF di consegna, email transazionali, reminder automatici.",
    "Display di sala sempre aggiornati. Calendario settimanale stampabile in formato A4.",
    "Prenota anche da chat. Telegram, WhatsApp, Signal, Email. Stesse regole, stesse quote.",
    "Bacheca multicanale, con avvisi mirati per ruolo, corso o edificio.",
    "Doppia autenticazione, log audit, pacchetto GDPR per la pubblica amministrazione italiana.",
    "Decisioni basate sui dati. Heatmap di occupazione, trend, export in un click.",
    "Settantasette test verdi, integrazione continua, deploy idempotente. Pronto per la produzione.",
    "Cadenza. Il tuo conservatorio, in armonia.",
]
assert len(NARRATION) == N


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        sys.exit(r.returncode)
    return r


async def synth_one(idx, text):
    out = os.path.join(VO_DIR, f"vo_{idx:02d}.mp3")
    wav = os.path.join(VO_DIR, f"vo_{idx:02d}.wav")
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    await communicate.save(out)
    run([FFMPEG, "-y", "-i", out, "-ac", "2", "-ar", "44100", wav])
    return wav


async def synth_all():
    return await asyncio.gather(*[synth_one(i, t) for i, t in enumerate(NARRATION)])


def voice_offset_ms(i):
    if i == 0:
        return 800
    return int((i * SLIDE_ADV + 0.6) * 1000)


def main():
    if not os.path.exists(VIDEO_IN):
        print(f"Missing {VIDEO_IN}. Run build_video.py first.", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(MUSIC):
        print(f"Missing music bed: {MUSIC}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(VO_DIR, exist_ok=True)

    print(f"TTS {N} lines · voice={VOICE} rate={RATE}")
    wavs = asyncio.run(synth_all())
    for i in range(N):
        print(f"  ✓ vo_{i:02d}.wav")

    cmd = [FFMPEG, "-y", "-i", VIDEO_IN]
    for w in wavs:
        cmd += ["-i", w]
    cmd += ["-i", MUSIC]
    music_idx = N + 1  # video is 0, voices 1..N, music at N+1

    parts = []
    for i in range(N):
        delay = voice_offset_ms(i)
        parts.append(
            f"[{i+1}:a]adelay={delay}|{delay},apad=pad_dur={TOTAL}[v{i}]"
        )

    parts.append(
        "".join(f"[v{i}]" for i in range(N))
        + f"amix=inputs={N}:duration=longest:dropout_transition=0:normalize=0[voice_raw]"
    )
    parts.append(
        "[voice_raw]volume=1.5,"
        "acompressor=threshold=-18dB:ratio=3:attack=20:release=200,"
        "asplit=2[voice][voice_sc]"
    )

    # Music bed: trim to total, soft-duck under voice via sidechain compression,
    # gentle fades, low overall volume so it stays under the narration.
    parts.append(
        f"[{music_idx}:a]atrim=0:{TOTAL},asetpts=N/SR/TB,aresample=44100,"
        f"volume=0.18,"
        f"afade=t=in:st=0:d=2.5,afade=t=out:st={TOTAL-2.5}:d=2.5[music_raw]"
    )
    # sidechain duck the music when voice is present
    parts.append(
        "[music_raw][voice_sc]sidechaincompress="
        "threshold=0.05:ratio=8:attack=20:release=300:makeup=1[music]"
    )

    parts.append(
        "[voice][music]amix=inputs=2:duration=first:weights=1.0 0.85:normalize=0,"
        f"alimiter=limit=0.95,afade=t=out:st={TOTAL-1}:d=1[mixed]"
    )

    cmd += [
        "-filter_complex", ";".join(parts),
        "-map", "0:v",
        "-map", "[mixed]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        VIDEO_OUT,
    ]

    print("Mixing audio (edge-tts voice + Inspired music bed)...")
    run(cmd)
    print(f"  ✓ {VIDEO_OUT}")


if __name__ == "__main__":
    main()
