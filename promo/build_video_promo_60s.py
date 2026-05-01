#!/usr/bin/env python3
"""Promo video di ~60 secondi tratto dalla presentazione
`Cadenza_Presentazione_Direzione.pptx`.

Pipeline:
1. Seleziona 12 slide chiave dalla presentazione (le PNG sono in
   `slides_proposta/`).
2. Sintesi vocale **ElevenLabs** se `ELEVENLABS_API_KEY` è presente in
   ambiente (voice IT professionale). Fallback automatico a Microsoft
   Edge Neural TTS `it-IT-DiegoNeural` (qualità simile, gratuito).
3. Tappeto musicale royalty-free Kevin MacLeod CC-BY 3.0
   (`music/inspired.mp3`) con sidechain compression sotto la voce.
4. Crossfade tra slide, fade-in/out audio, alimiter -1 dB.

Output:
- promo/cadenza_promo_60s.mp4 (~60 s, 1080p)
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FFMPEG = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg"
SLIDES_DIR = ROOT / "slides_proposta"
MUSIC = ROOT / "music" / "inspired.mp3"
VO_DIR = ROOT / "vo_promo60"
SILENT = ROOT / "cadenza_promo_60s_silent.mp4"
OUT = ROOT / "cadenza_promo_60s.mp4"
VO_DIR.mkdir(exist_ok=True)

# ────────── tempi ──────────
SLIDE_DUR = 5.5      # ogni slide
XFADE = 0.5          # crossfade tra slide
FPS = 30
W, H = 1920, 1080
# 12 slide × 5.5 - 11 × 0.5 = 66 - 5.5 = 60.5s totali ≈ 1 min

# ────────── slide selezionate (12 chiave per 60 s) ──────────
SELECTED = [
    # (filename in slides_proposta, line di narrazione)
    ("slide_01.png",
     "Cadenza. Una piattaforma open-source per la prenotazione delle aule, "
     "progettata specificamente per i conservatori italiani."),
    ("slide_03.png",
     "Trentun modelli, cento endpoint API, centosessantanove test verdi. "
     "Tre lingue, deploy in mezza giornata, zero lock-in cloud."),
    ("slide_04.png",
     "Quattro domini in un'unica piattaforma: prenotazione aule, Monte Ore "
     "docenti, inventario strumenti, avvisi e kiosk."),
    ("slide_05.png",
     "Dashboard del docente: KPI personali, calendario aule giornaliero, "
     "agenda delle prossime prenotazioni."),
    ("slide_07.png",
     "Prenotazione in tre tap, con timeline a slot da trenta minuti e "
     "anti-overlap garantito a livello di database."),
    ("slide_08.png",
     "Monte Ore docenti: il primo sistema italiano che digitalizza il "
     "workflow contrattuale del Conservatorio."),
    ("slide_09.png",
     "Analytics per la direzione: heatmap di occupazione, top aule, "
     "trend di otto settimane, export in un click."),
    ("slide_11.png",
     "Rispetto ad ASIMUT, costiamo dal venti al sessanta per cento in meno, "
     "con tutte le verticali italiane native."),
    ("slide_13.png",
     "Italiano per definizione: codice sviluppato in Italia, "
     "GDPR Garante, MEPA-ready, roadmap SPID."),
    ("slide_14.png",
     "Software gratuito. Pagate solo l'infrastruttura: VPS sotto i "
     "venti euro al mese, dominio, backup, abbonamento Claude."),
    ("slide_15.png",
     "Su dieci anni il risparmio supera i duecentomila euro: "
     "quattro stipendi docente o quaranta borse di studio."),
    ("slide_19.png",
     "Cadenza. Un dono al Conservatorio. "
     "Per i prossimi dieci anni almeno."),
]

N = len(SELECTED)
TOTAL = N * SLIDE_DUR - (N - 1) * XFADE
# ogni voce parte ~0.4s dopo l'inizio della propria slide
SLIDE_ADV = SLIDE_DUR - XFADE


def run(cmd, **kw):
    r = subprocess.run(cmd, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        sys.exit(r.returncode)
    return r


# ────────── 1) build silent video da PNG ──────────


def build_silent_video():
    if not FFMPEG.exists():
        sys.exit(f"ffmpeg not found at {FFMPEG}")
    cmd = [str(FFMPEG), "-y"]
    paths = [SLIDES_DIR / fn for fn, _ in SELECTED]
    for p in paths:
        if not p.exists():
            sys.exit(f"Slide mancante: {p}")
        cmd += ["-loop", "1", "-framerate", "1", "-t", "1", "-i", str(p)]
    d_frames = int(SLIDE_DUR * FPS)
    chains = []
    for i in range(N):
        zoom_expr = f"1+0.025*on/{d_frames}" if i % 2 == 0 else f"1.025-0.025*on/{d_frames}"
        chains.append(
            f"[{i}:v]scale=2400:1350:force_original_aspect_ratio=decrease,"
            f"pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,"
            f"zoompan=z='{zoom_expr}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={d_frames}:s={W}x{H}:fps={FPS},"
            f"trim=duration={SLIDE_DUR},setpts=PTS-STARTPTS,"
            f"format=yuv420p[v{i}]"
        )
    last = "v0"
    for i in range(1, N):
        offset = i * SLIDE_DUR - i * XFADE
        out_label = f"x{i:02d}"
        chains.append(
            f"[{last}][v{i}]xfade=transition=fade:"
            f"duration={XFADE}:offset={offset:.3f}[{out_label}]"
        )
        last = out_label
    cmd += [
        "-filter_complex", ";".join(chains),
        "-map", f"[{last}]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-movflags", "+faststart",
        str(SILENT),
    ]
    print(f"[1/3] Silent video → {SILENT.name}  (target {TOTAL:.1f}s)")
    run(cmd)


# ────────── 2) sintesi vocale ──────────


def synth_elevenlabs(idx: int, text: str) -> Path:
    """ElevenLabs IT pro voice."""
    from elevenlabs.client import ElevenLabs
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    voice_id = os.environ.get(
        "ELEVENLABS_VOICE_ID",
        "TxGEqnHWrfWFTfGW9XjX",  # "Josh" — voce maschile pro multilingua;
                                   # override via env se l'utente preferisce
                                   # un'altra (es. una italiana custom).
    )
    model_id = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    client = ElevenLabs(api_key=api_key)
    print(f"  [el-{idx:02d}] {text[:64]}…")
    audio_iter = client.text_to_speech.convert(
        voice_id=voice_id,
        model_id=model_id,
        text=text,
        output_format="mp3_44100_128",
        voice_settings={
            "stability": 0.55,
            "similarity_boost": 0.85,
            "style": 0.20,
            "use_speaker_boost": True,
        },
    )
    out = VO_DIR / f"vo_{idx:02d}.mp3"
    with open(out, "wb") as f:
        for chunk in audio_iter:
            if chunk:
                f.write(chunk)
    wav = VO_DIR / f"vo_{idx:02d}.wav"
    run([str(FFMPEG), "-y", "-i", str(out), "-ac", "2", "-ar", "44100", str(wav)])
    return wav


async def synth_edge_tts(idx: int, text: str) -> Path:
    """Microsoft Edge Neural TTS — fallback gratuito (it-IT-DiegoNeural)."""
    import edge_tts
    voice = os.environ.get("EDGE_TTS_VOICE", "it-IT-DiegoNeural")
    rate = "-3%"
    pitch = "-1Hz"
    print(f"  [ms-{idx:02d}] {text[:64]}…")
    out = VO_DIR / f"vo_{idx:02d}.mp3"
    await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(out))
    wav = VO_DIR / f"vo_{idx:02d}.wav"
    run([str(FFMPEG), "-y", "-i", str(out), "-ac", "2", "-ar", "44100", str(wav)])
    return wav


def synth_all() -> list[Path]:
    if os.environ.get("ELEVENLABS_API_KEY"):
        print(f"[2/3] Voce ElevenLabs (multilingual_v2) — {N} segmenti")
        return [synth_elevenlabs(i, txt) for i, (_, txt) in enumerate(SELECTED)]
    print(f"[2/3] Voce edge-tts it-IT-DiegoNeural (fallback) — {N} segmenti")

    async def _all():
        return await asyncio.gather(
            *[synth_edge_tts(i, txt) for i, (_, txt) in enumerate(SELECTED)]
        )
    return asyncio.run(_all())


# ────────── 3) mix audio + voce + tappeto musicale ──────────


def voice_offset_ms(i: int) -> int:
    if i == 0:
        return 400
    return int((i * SLIDE_ADV + 0.4) * 1000)


def mix_audio(wavs: list[Path]):
    cmd = [str(FFMPEG), "-y", "-i", str(SILENT)]
    for w in wavs:
        cmd += ["-i", str(w)]
    cmd += ["-i", str(MUSIC)]
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
    parts.append(
        f"[{music_idx}:a]aloop=loop=-1:size=2e+09,atrim=0:{TOTAL},"
        f"asetpts=N/SR/TB,aresample=44100,volume=0.16,"
        f"afade=t=in:st=0:d=2,afade=t=out:st={TOTAL-2}:d=2[music_raw]"
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
        "-map", "0:v", "-map", "[mixed]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart",
        str(OUT),
    ]
    print(f"[3/3] Mix audio → {OUT.name}")
    run(cmd)


def main():
    if not MUSIC.exists():
        sys.exit(f"Tappeto musicale mancante: {MUSIC}")
    build_silent_video()
    wavs = synth_all()
    mix_audio(wavs)
    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"\n✓ Video promo pronto: {OUT}  ({size_mb:.1f} MB · {TOTAL:.1f}s)")


if __name__ == "__main__":
    main()
