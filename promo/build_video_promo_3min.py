#!/usr/bin/env python3
"""Promo istituzionale di ~3 minuti per "Cadenza".

Tono: autorevole, entusiasta ma sobrio — adatto a presentazione alla
Direzione di un Conservatorio.

Pipeline:
1. Costruzione video silenzioso da slides_proposta/*.png con Ken-Burns
   (zoom + pan delicati su ogni slide, più marcati sulle slide screenshot).
2. Sintesi vocale: ElevenLabs se `ELEVENLABS_API_KEY` è in ambiente,
   altrimenti fallback edge-tts `it-IT-DiegoNeural` (voce maschile
   neural, autorevole, adatta al contesto formale).
3. Tappeto musicale royalty-free CC-BY 3.0 ("Andrea's Theme" di
   Kevin MacLeod — orchestrale warm, italiano-mediterranea).
4. Mix con sidechain compression (musica si abbassa quando parla la
   voce), fade-in/out, alimiter -1 dB.

Output: promo/cadenza_promo_3min.mp4
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
MUSIC = ROOT / "music" / "andreas_theme.mp3"
VO_DIR = ROOT / "vo_promo3min"
SILENT = ROOT / "cadenza_promo_3min_silent.mp4"
OUT = ROOT / "cadenza_promo_3min.mp4"
VO_DIR.mkdir(exist_ok=True)

# ────────── pacing per ~3 min ──────────
# 18 slide × 10.6s − 17 × 0.6s = 190.8s − 10.2 = ~180s.
SLIDE_DUR = 10.6
XFADE = 0.6
FPS = 30
W, H = 1920, 1080

# Slide selezionate (ordine narrativo): tutte le 19 escluse le ridondanze.
# Ognuna copre una sezione della struttura richiesta.
SELECTED = [
    # (filename, narration line, ken-burns intensity 0..2)
    # 0..2: 0=zoom statico leggero, 1=zoom-in/out morbido,
    #       2=zoom + pan deciso (per le screenshot)
    # ── INTRODUZIONE: Problema dei conservatori ──
    ("slide_01.png",
     "Cadenza. Una piattaforma open-source per la gestione delle aule, "
     "sviluppata da un docente del Conservatorio, "
     "donata gratuitamente all'Istituzione.", 1),
    ("slide_02.png",
     "Ventuno miliardi di euro stanziati dal PNRR per la digitalizzazione "
     "dell'alta formazione artistica e musicale. "
     "Ma le soluzioni sul mercato non sono italiane.", 1),

    # ── COS'È CADENZA ──
    ("slide_03.png",
     "Trentun modelli, cento endpoint API, centosessantanove test "
     "automatici verdi. Tre lingue, deploy in mezza giornata. "
     "Production-ready su pubblica amministrazione italiana.", 1),
    ("slide_04.png",
     "Quattro domini integrati in un'unica piattaforma: "
     "prenotazione aule, Monte Ore docenti, "
     "inventario strumenti, avvisi multicanale e display kiosk.", 1),

    # ── VANTAGGI: schermate reali del software ──
    ("slide_05.png",
     "La dashboard del docente: agenda quotidiana, calendario aule "
     "giornaliero con drag-to-create, prossime sessioni, "
     "ore residue settimanali, tutto in un'unica vista.", 2),
    ("slide_07.png",
     "Prenotazione self-service in tre tap. "
     "Timeline a slot da trenta minuti. "
     "Anti-overlap garantito a livello database, non solo applicativo.", 2),
    ("slide_08.png",
     "Per la prima volta in Italia, il workflow contrattuale del "
     "Monte Ore docenti è completamente digitale: "
     "vincoli giorni-settimana, soglia trecentoventiquattro ore annue, "
     "approvazione del coordinatore.", 2),
    ("slide_09.png",
     "Per la Direzione: heatmap di occupazione sette per ventiquattro, "
     "top aule per utilizzo, trend di otto settimane, "
     "tasso di no-show. Esportazione CSV e PDF immediata.", 2),

    # ── CONFRONTO ──
    ("slide_11.png",
     "Confronto con ASIMUT: stesse funzionalità di base, "
     "ma con tutte le verticali italiane native. "
     "Costo da venti a sessanta volte inferiore.", 1),
    ("slide_12.png",
     "Confronto con EasyStaff: Cadenza è verticale sul Conservatorio "
     "dal primo giorno. Niente moduli generalisti per atenei. "
     "Pensata solo per il vostro contesto.", 1),

    # ── GARANZIE ──
    ("slide_13.png",
     "Italiano per definizione: codice sviluppato in Italia, "
     "GDPR Garante zero-sei-duemilaventuno, "
     "roadmap SPID, ANIS, MEPA-ready dal primo giorno.", 1),

    # ── COSTI REALI ──
    ("slide_14.png",
     "Software gratuito. Pagate solo l'infrastruttura: "
     "quattrocentosessantatré euro all'anno, tutto incluso. "
     "Nessuna licenza. Nessun canone. Nessun lock-in vendor.", 1),

    # ── RISPARMIO ──
    ("slide_15.png",
     "Su dieci anni il risparmio rispetto ad ASIMUT supera "
     "i duecentoventimila euro. "
     "Equivalenti a quattro stipendi docente, "
     "quaranta borse di studio, due organi a canne.", 1),

    # ── ATTIVAZIONE ──
    ("slide_16.png",
     "Sette provider compatibili — da Hetzner ad Aruba, "
     "da Ionos a OVH. Tutti sotto la soglia dell'affidamento diretto. "
     "Fattura elettronica per la pubblica amministrazione garantita.", 1),
    ("slide_17.png",
     "Dalla decisione all'operatività in due-quattro settimane. "
     "Provisioning, import dati, branding, formazione: "
     "tutto a carico dell'autore.", 1),

    # ── CHIUSURA ──
    ("slide_19.png",
     "Cadenza. Un dono al Conservatorio. "
     "Per i prossimi dieci anni almeno. "
     "Una demo dal vivo, in italiano, con Danilo Russo, "
     "docente del Conservatorio.", 0),
]

N = len(SELECTED)
TOTAL = N * SLIDE_DUR - (N - 1) * XFADE
SLIDE_ADV = SLIDE_DUR - XFADE


def run(cmd, **kw):
    r = subprocess.run(cmd, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        sys.exit(r.returncode)
    return r


# ────────── 1) Silent video con Ken Burns morbido ──────────


def build_silent_video():
    if not FFMPEG.exists():
        sys.exit(f"ffmpeg not found at {FFMPEG}")
    cmd = [str(FFMPEG), "-y"]
    paths = [SLIDES_DIR / fn for fn, _, _ in SELECTED]
    for p in paths:
        if not p.exists():
            sys.exit(f"Slide mancante: {p}")
        cmd += ["-loop", "1", "-framerate", "1", "-t", "1", "-i", str(p)]

    d_frames = int(SLIDE_DUR * FPS)
    chains = []
    for i, (_, _, intensity) in enumerate(SELECTED):
        # zoom range proporzionale a intensity
        z_lo, z_hi = 1.0, 1.025 + 0.020 * intensity   # 0→1.025, 1→1.045, 2→1.065
        z_dir = 1 if i % 2 == 0 else -1               # alternato in/out
        if z_dir > 0:
            zoom_expr = f"{z_lo}+({z_hi - z_lo})*on/{d_frames}"
        else:
            zoom_expr = f"{z_hi}-({z_hi - z_lo})*on/{d_frames}"

        # Pan delicato (solo per intensity >= 1)
        if intensity == 0:
            x_expr = "iw/2-(iw/zoom/2)"
            y_expr = "ih/2-(ih/zoom/2)"
        elif intensity == 1:
            # piccolo drift orizzontale
            sign = 1 if i % 2 == 0 else -1
            x_expr = f"iw/2-(iw/zoom/2)+{sign}*0.012*iw*on/{d_frames}"
            y_expr = "ih/2-(ih/zoom/2)"
        else:
            # screenshot: pan + zoom + leggero tilt verticale
            sign = 1 if i % 2 == 0 else -1
            x_expr = f"iw/2-(iw/zoom/2)+{sign}*0.020*iw*on/{d_frames}"
            y_expr = f"ih/2-(ih/zoom/2)+{sign}*0.010*ih*on/{d_frames}"

        chains.append(
            f"[{i}:v]scale=2400:1350:force_original_aspect_ratio=decrease,"
            f"pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,"
            f"zoompan=z='{zoom_expr}':"
            f"x='{x_expr}':y='{y_expr}':"
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
    print(f"[1/3] Silent video con Ken-Burns → {SILENT.name} (target {TOTAL:.1f}s)")
    run(cmd)


# ────────── 2) sintesi vocale ──────────


def synth_elevenlabs(idx: int, text: str) -> Path:
    """ElevenLabs IT pro voice — usato se ELEVENLABS_API_KEY è in env."""
    from elevenlabs.client import ElevenLabs
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    voice_id = os.environ.get(
        "ELEVENLABS_VOICE_ID",
        "TxGEqnHWrfWFTfGW9XjX",  # Josh — voce multilingua maschile pro
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
            "style": 0.18,
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
    rate = "-5%"   # leggermente più lento per gravitas istituzionale
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
        return [synth_elevenlabs(i, txt) for i, (_, txt, _) in enumerate(SELECTED)]
    print(f"[2/3] Voce edge-tts it-IT-DiegoNeural (fallback) — {N} segmenti")

    async def _all():
        return await asyncio.gather(
            *[synth_edge_tts(i, txt) for i, (_, txt, _) in enumerate(SELECTED)]
        )
    return asyncio.run(_all())


# ────────── 3) Mix audio ──────────


def voice_offset_ms(i: int) -> int:
    if i == 0:
        return 600
    return int((i * SLIDE_ADV + 0.5) * 1000)


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
    # Tappeto musicale: low volume (0.13), fade-in 3s, fade-out 4s
    parts.append(
        f"[{music_idx}:a]aloop=loop=-1:size=2e+09,atrim=0:{TOTAL},"
        f"asetpts=N/SR/TB,aresample=44100,volume=0.13,"
        f"afade=t=in:st=0:d=3,afade=t=out:st={TOTAL-4}:d=4[music_raw]"
    )
    parts.append(
        "[music_raw][voice_sc]sidechaincompress="
        "threshold=0.04:ratio=10:attack=15:release=400:makeup=1[music]"
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
    print(f"[3/3] Mix audio (voce + Andrea's Theme) → {OUT.name}")
    run(cmd)


def main():
    if not MUSIC.exists():
        sys.exit(f"Tappeto musicale mancante: {MUSIC}")
    build_silent_video()
    wavs = synth_all()
    mix_audio(wavs)
    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"\n✓ Video promo 3 min pronto: {OUT}  ({size_mb:.1f} MB · {TOTAL:.1f}s)")


if __name__ == "__main__":
    main()
