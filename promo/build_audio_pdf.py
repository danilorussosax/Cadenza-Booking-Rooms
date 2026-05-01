#!/usr/bin/env python3
"""Add Italian neural voiceover (edge-tts) + royalty-free MP3 bed to
aulabook_promo.mp4."""

import asyncio
import os
import subprocess
import sys

import edge_tts

ROOT = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg")
VO_DIR = os.path.join(ROOT, "vo_pdf")
MUSIC = os.path.join(ROOT, "music", "movement_proposition.mp3")
VIDEO_IN = os.path.join(ROOT, "aulabook_promo.mp4")
VIDEO_OUT = os.path.join(ROOT, "aulabook_promo_audio.mp4")

# Switch to a male neural voice for the PDF/AulaBook variant for variety.
VOICE = "it-IT-DiegoNeural"
RATE = "-3%"
PITCH = "-1Hz"

SLIDE_DUR = 8.0
XFADE = 0.5
SLIDE_ADV = SLIDE_DUR - XFADE  # 7.5s
N = 16
TOTAL = N * SLIDE_DUR - (N - 1) * XFADE  # 120.5s

NARRATION = [
    "Aula Book. Il sistema di prenotazione aule per il conservatorio. Meno carta, zero doppie prenotazioni.",
    "Come si gestiscono oggi le aule? Excel condivisi, telefonate alla segreteria, conflitti continui.",
    "Aula Book unisce prenotazione, monitoraggio e decisione in una sola piattaforma.",
    "La dashboard del docente: agenda personale, prenotazioni recenti, prossime lezioni.",
    "Senza Aula Book: telefonate, attese, conferme che arrivano dopo ore.",
    "Con Aula Book il professore prenota dal cellulare in pochi secondi. Tutto in tempo reale.",
    "Vista settimanale aule per giorni. Tutto il conservatorio in un'unica griglia.",
    "Form di prenotazione in cinque campi. Verifica disponibilità e conferma.",
    "Doppie prenotazioni? Tecnicamente impossibili. Tre layer indipendenti di protezione.",
    "Statistiche di utilizzo per la direzione. Decisioni informate, non a sensazione.",
    "Centoventi ore di segreteria liberate ogni anno. Zero conflitti documentati.",
    "Tabelloni digitali pubblici. Le aule comunicano da sole, in ogni edificio.",
    "SSO, doppia autenticazione, audit completo. Conforme GDPR di default.",
    "Infrastruttura economica. Listini pubblici dei principali provider VPS europei.",
    "Niente isole digitali. Aula Book parla con Isidata, anagrafica e calendari accademici.",
    "Pronti a iniziare? Mezza giornata di setup. Risultati dal primo giorno.",
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
        return 600
    return int((i * SLIDE_ADV + 0.5) * 1000)


def main():
    if not os.path.exists(VIDEO_IN):
        print(f"Missing {VIDEO_IN}. Run build_video_pdf.py first.", file=sys.stderr)
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
    music_idx = N + 1

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

    # Loop music if shorter than TOTAL, then trim to TOTAL.
    parts.append(
        f"[{music_idx}:a]aloop=loop=-1:size=2e+09,atrim=0:{TOTAL},"
        f"asetpts=N/SR/TB,aresample=44100,volume=0.18,"
        f"afade=t=in:st=0:d=2.5,afade=t=out:st={TOTAL-2.5}:d=2.5[music_raw]"
    )
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

    print("Mixing audio (edge-tts Diego + Movement Proposition bed)...")
    run(cmd)
    print(f"  ✓ {VIDEO_OUT}")


if __name__ == "__main__":
    main()
