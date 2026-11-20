// Diagnostica: snapshot dell'ambiente di rendering del browser TV (`?debug=1`).
export interface DebugInfo {
  innerW: number;
  innerH: number;
  outerW: number;
  outerH: number;
  screenW: number;
  screenH: number;
  dpr: number;
  rootFontPx: number;
  displayScale: string;
  ua: string;
  lang: string;
  category: '4K' | 'QHD' | 'FHD' | 'HD' | 'SUB-HD';
  themeStored: string;
  themeResolved: 'light' | 'dark';
  prefersDark: boolean;
  prefersLight: boolean;
  prefersContrastMore: boolean;
  prefersReducedMotion: boolean;
}

export function snapshotDebugInfo(): DebugInfo {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const w = window.innerWidth;
  const h = window.innerHeight;
  let category: DebugInfo['category'] = 'SUB-HD';
  if (w >= 3800) category = '4K';
  else if (w >= 2500) category = 'QHD';
  else if (w >= 1900) category = 'FHD';
  else if (w >= 1200) category = 'HD';
  const stored = localStorage.getItem('conservatory_theme') ?? 'system';
  const themeResolved: 'light' | 'dark' = html.classList.contains('dark') ? 'dark' : 'light';
  const mq = window.matchMedia;
  const prefersDark = mq('(prefers-color-scheme: dark)').matches;
  const prefersLight = mq('(prefers-color-scheme: light)').matches;
  const prefersContrastMore = mq('(prefers-contrast: more)').matches;
  const prefersReducedMotion = mq('(prefers-reduced-motion: reduce)').matches;
  return {
    innerW: w,
    innerH: h,
    outerW: window.outerWidth,
    outerH: window.outerHeight,
    screenW: window.screen.width,
    screenH: window.screen.height,
    dpr: window.devicePixelRatio,
    rootFontPx: parseFloat(cs.fontSize),
    displayScale: html.style.getPropertyValue('--display-scale') || '1',
    ua: navigator.userAgent,
    lang: navigator.language,
    category,
    themeStored: stored,
    themeResolved,
    prefersDark,
    prefersLight,
    prefersContrastMore,
    prefersReducedMotion,
  };
}
