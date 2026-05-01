#!/usr/bin/env python3
"""Add Italian neural voiceover (edge-tts) + royalty-free music bed to
cadenza_proposta.mp4."""

import asyncio
import os
import subprocess
import sys

import edge_tts

ROOT = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg")
VO_DIR = os.path.join(ROOT, "vo_proposta")
MUSIC = os.path.join(ROOT, "music", "inspired.mp3")
VIDEO_IN = os.path.join(ROOT, "cadenza_proposta.mp4")
VIDEO_OUT = os.path.join(ROOT, "cadenza_proposta_audio.mp4")

VOICE = "it-IT-IsabellaNeural"
RATE = "-3%"
PITCH = "-2Hz"

SLIDE_DUR = 8.0
XFADE = 0.5
SLIDE_ADV = SLIDE_DUR - XFADE  # 7.5s
N = 18
TOTAL = N * SLIDE_DUR - (N - 1) * XFADE  # 135.5s

# Una riga di narrazione per slide, allineata a SLIDES in
# generate_proposta_pdf.py. Tono "executive friendly", non vendita aggressiva.
NARRATION = [
    # 1 cover
    "Cadenza. La piattaforma di prenotazione aule pensata per i conservatori italiani.",
    # 2 perché
    "Ventuno miliardi di PNRR per la digitalizzazione AFAM. Ma le soluzioni sul mercato non sono italiane.",
    # 3 cosa è
    "Trentun modelli, cento endpoint, centosessantanove test verdi. Tre lingue. Open-source, deploy in mezza giornata.",
    # 4 4 risposte
    "Booking aule, Monte Ore docenti, inventario strumenti, avvisi e kiosk. Quattro domini, una sola piattaforma.",
    # 5 dashboard
    "Dashboard del docente: agenda, calendario aule giornaliero, prossime prenotazioni. Tutto in uno schermo.",
    # 6 rooms
    "Catalogo aule del Conservatorio, navigabile per edificio, capienza, dotazione strumentale.",
    # 7 booking
    "Prenotazione in tre tap, con timeline a slot da trenta minuti e legenda per tipologia.",
    # 8 monte ore
    "Monte Ore docenti: il primo sistema italiano che digitalizza il workflow contrattuale del Conservatorio.",
    # 9 analytics
    "Analytics per la direzione: heatmap di occupazione, top aule, trend di otto settimane, export in un click.",
    # 10 struttura
    "Struttura completa: istituti, edifici, aule, dotazioni — tutto in una pagina con filtri e ricerca.",
    # 11 vs ASIMUT
    "Rispetto ad ASIMUT, costiamo dal venti al sessanta per cento in meno, con tutte le verticali italiane native.",
    # 12 vs EasyStaff
    "Rispetto a EasyStaff, siamo verticali sui Conservatori dal giorno uno: niente moduli generalisti, solo AFAM.",
    # 13 compliance
    "Italiano per definizione: codice sviluppato in Italia, GDPR Garante, roadmap SPID e ANIS, MEPA-ready.",
    # 14 listino
    "Listino chiaro a quattro livelli, dal Self-Host a ottocento euro fino a Enterprise PA a novemilaseicento.",
    # 15 simulazione
    "Su cinque anni, un conservatorio medio risparmia sessantottomila euro. Un grande conservatorio centoquattordicimila.",
    # 16 pilota
    "Pilota gratuito di sei mesi sul primo dipartimento. Setup in mezza giornata. Decisione finale solo sui risultati.",
    # 17 roadmap
    "Roadmap a dodici mesi: sei sprint operativi, dalla user experience alla compliance PA italiana.",
    # 18 CTA
    "Vediamoci. Una demo dal vivo, in italiano, per ridurre mesi di valutazione a trenta minuti.",
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
        print(f"Missing {VIDEO_IN}. Run build_video_proposta.py first.", file=sys.stderr)
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
        parts.append(f"[{i+1}:a]adelay={delay}|{delay},apad=pad_dur={TOTAL}[v{i}]")

    parts.append(
        "".join(f"[v{i}]" for i in range(N))
        + f"amix=inputs={N}:duration=longest:dropout_transition=0:normalize=0[voice_raw]"
    )
    parts.append(
        "[voice_raw]volume=1.5,"
        "acompressor=threshold=-18dB:ratio=3:attack=20:release=200,"
        "asplit=2[voice][voice_sc]"
    )
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

    print("Mixing audio (edge-tts Isabella + Inspired bed)...")
    run(cmd)
    print(f"  ✓ {VIDEO_OUT}")


if __name__ == "__main__":
    main()
