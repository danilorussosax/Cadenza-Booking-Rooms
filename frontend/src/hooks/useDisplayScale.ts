import { useEffect } from 'react';

interface Options {
  /**
   * Larghezza viewport considerata "1x". Default 1920 (FullHD).
   *
   * NB: alcuni browser TV (Tizen, webOS, Chromecast) riportano un viewport
   * "logico" molto piu piccolo del pannello fisico, es. 1200×615 con DPR 2
   * su un pannello 4K. In questi casi vogliamo che il layout non resti
   * troppo grande (text wrap, banner sovrapposti) — il min-clamp lascia
   * scendere la scala fino a 0.7× per garantire che il contenuto entri.
   */
  baseWidth?: number;
  /** Altezza viewport considerata "1x". Default 1080 (FullHD). */
  baseHeight?: number;
  /** Fattore minimo: evita di rimpicciolire troppo. */
  min?: number;
  /** Fattore massimo: cap su display molto grandi (videowall 8K). */
  max?: number;
  /** Root font-size base in px. Default 16. */
  rootBase?: number;
}

/**
 * Auto-scaling del kiosk pubblico in base alla risoluzione del display
 * (HDMI / monitor / videowall) connesso al browser. Imposta
 * `document.documentElement.style.fontSize` proporzionalmente al rapporto
 * tra viewport corrente e baseline FullHD (1920×1080), così che TUTTI i
 * valori `rem` di Tailwind (text-*, h-*, w-*, p-*, ecc.) si scalino in
 * modo uniforme.
 *
 * Strategia di calcolo:
 *   scale = min(viewportWidth / 1920, viewportHeight / 1080)
 *   clamped between [min, max]
 *
 * L'uso di `min(...)` evita over-scaling sui display ultrawide o portrait
 * — il fattore vincolante è l'asse più "piccolo" rispetto alla baseline.
 *
 * Override manuale via query string: `?scale=1.5` forza un fattore fisso,
 * utile per fine-tuning su display non standard (5K, retina con DPI
 * scaling OS, videowall a tassellatura).
 *
 * Espone anche la CSS custom property `--display-scale` per componenti
 * che devono leggere il fattore (es. dimensioni canvas, immagini bg).
 *
 * Cleanup: al dismount ripristina il root font-size di default così le
 * altre pagine dell'app non sono influenzate.
 */
export function useDisplayScale(opts: Options = {}): void {
  const baseWidth = opts.baseWidth ?? 1920;
  const baseHeight = opts.baseHeight ?? 1080;
  // Min 0.7: alcuni browser TV (Tizen/webOS) riportano viewport logici piccoli
  // (1200×615 con DPR 2) — a 0.7× tutto entra, mentre 0.85× lasciava il banner
  // a sovrapporsi alla griglia settimanale.
  const min = opts.min ?? 0.7;
  const max = opts.max ?? 3;
  const rootBase = opts.rootBase ?? 16;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('scale');
    let manualScale: number | null = null;
    if (override) {
      const n = parseFloat(override);
      if (Number.isFinite(n) && n > 0.5 && n < 6) {
        manualScale = n;
      }
    }

    const apply = (): void => {
      const w = window.innerWidth || document.documentElement.clientWidth;
      const h = window.innerHeight || document.documentElement.clientHeight;
      const autoW = w / baseWidth;
      const autoH = h / baseHeight;
      const auto = Math.min(autoW, autoH);
      const scale = manualScale ?? Math.max(min, Math.min(max, auto));
      document.documentElement.style.fontSize = `${(rootBase * scale).toFixed(3)}px`;
      document.documentElement.style.setProperty('--display-scale', scale.toFixed(4));
    };
    apply();

    window.addEventListener('resize', apply);
    // Alcuni browser emettono "orientationchange" su sistemi con sensore.
    window.addEventListener('orientationchange', apply);
    // Se il display HDMI cambia DPI a runtime (rara, ma possibile su Linux X11
    // con `xrandr --scale`), il media query forza un re-render.
    const dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const dprHandler = (): void => {
      apply();
    };
    dpr.addEventListener('change', dprHandler);

    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      dpr.removeEventListener('change', dprHandler);
      document.documentElement.style.fontSize = '';
      document.documentElement.style.removeProperty('--display-scale');
    };
  }, [baseWidth, baseHeight, min, max, rootBase]);
}
