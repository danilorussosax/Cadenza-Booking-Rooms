import type { DebugInfo } from '@/lib/displayDebug';

export function DebugOverlay({ info }: { info: DebugInfo }) {
  const themeBadge = info.themeResolved === 'dark' ? '🌙 NOTTE' : '☀️ GIORNO';
  const sysBadge = info.prefersDark ? 'sys=dark' : info.prefersLight ? 'sys=light' : 'sys=?';
  const isOverride = info.themeStored !== 'system';
  return (
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-50 max-w-md rounded-lg border border-emerald-400/60 bg-black/80 px-3 py-2 font-mono text-[0.6875rem] leading-tight text-emerald-300 shadow-xl backdrop-blur-sm"
      role="status"
      aria-live="off"
    >
      <div className="mb-1 font-bold text-emerald-100">DISPLAY DEBUG · {info.category}</div>
      <div>
        viewport:{' '}
        <span className="text-white">
          {info.innerW}×{info.innerH}
        </span>{' '}
        · outer: {info.outerW}×{info.outerH}
      </div>
      <div>
        screen: {info.screenW}×{info.screenH} · DPR: <span className="text-white">{info.dpr}</span>
      </div>
      <div>
        root font: <span className="text-white">{info.rootFontPx.toFixed(2)}px</span> · scale:{' '}
        <span className="text-white">{Number(info.displayScale).toFixed(3)}×</span>
      </div>
      <div className="mt-1 border-t border-emerald-400/30 pt-1">
        theme: <span className="text-white">{themeBadge}</span> · stored:{' '}
        <span className="text-white">{info.themeStored}</span>
        {isOverride && <span className="text-amber-300"> (override)</span>}
      </div>
      <div className="text-emerald-400/80">
        {sysBadge}
        {info.prefersContrastMore && ' · contrast=more'}
        {info.prefersReducedMotion && ' · motion=reduce'}
      </div>
      <div className="mt-1 text-emerald-400/70">lang: {info.lang}</div>
      <div className="truncate text-emerald-400/60" title={info.ua}>
        UA: {info.ua.slice(0, 60)}
        {info.ua.length > 60 ? '…' : ''}
      </div>
    </div>
  );
}
