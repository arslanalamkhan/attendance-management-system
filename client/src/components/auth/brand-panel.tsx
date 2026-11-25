import { useMemo } from 'react';
import { BrandMark } from '../layout/brand';
import { cn } from '../../lib/utils';

type Pt = [number, number];

/** Closed Catmull-Rom spline through the points, as a cubic-bezier SVG path. */
function smoothClosed(pts: Pt[]): string {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n] as Pt;
  let d = `M${at(0)[0].toFixed(1)} ${at(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

function contour(cx: number, cy: number, r: number, phase: number, squash: number): string {
  const pts: Pt[] = [];
  const steps = 28;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wobble = 1 + 0.1 * Math.sin(3 * t + phase) + 0.06 * Math.sin(5 * t + phase * 1.7) + 0.03 * Math.sin(9 * t + phase * 0.6);
    pts.push([cx + Math.cos(t) * r * wobble, cy + Math.sin(t) * r * wobble * squash]);
  }
  return smoothClosed(pts);
}

/** Subtle topographic contour lines in brand green. Purely decorative. */
export function ContourPattern({ className }: { className?: string }) {
  const rings = useMemo(() => {
    const out: { d: string; o: number }[] = [];
    // two "hills": a large one bottom-right and a smaller one top-left
    for (let i = 0; i < 17; i++) out.push({ d: contour(640, 760, 40 + i * 34, i * 0.28, 0.82), o: 0.07 + (i % 4 === 0 ? 0.1 : 0) });
    for (let i = 0; i < 9; i++) out.push({ d: contour(90, 150, 30 + i * 30, 2 + i * 0.35, 0.9), o: 0.06 + (i % 4 === 0 ? 0.08 : 0) });
    return out;
  }, []);
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn('pointer-events-none absolute inset-0 size-full', className)}>
      <g fill="none" stroke="#6ee7b7" strokeWidth="1">
        {rings.map((r, i) => (
          <path key={i} d={r.d} strokeOpacity={r.o} />
        ))}
      </g>
    </svg>
  );
}

/** Dark-green brand surface; deliberately not theme-dependent so the brand reads the same in light and dark. */
export function BrandPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative isolate flex flex-col justify-between overflow-hidden bg-[#04251c] p-10 text-white xl:p-14',
        'bg-[radial-gradient(120%_80%_at_0%_0%,#0b6a4e_0%,#064e3b_38%,#04251c_100%)]',
        className,
      )}
    >
      <ContourPattern />
      <div className="relative flex items-center gap-3">
        <span className="text-sm font-semibold tracking-[0.18em] text-emerald-100/90">NACTA</span>
        <span className="h-3 w-px bg-emerald-100/30" aria-hidden="true" />
        <span className="text-xs tracking-wide text-emerald-100/70">Government of Pakistan</span>
      </div>

      <div className="relative max-w-md space-y-5">
        <div className="relative w-fit">
          <div className="absolute -inset-3 rounded-full bg-white/10 blur-xl" aria-hidden="true" />
          <BrandMark large className="relative size-28 drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)] xl:size-32" />
        </div>
        <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">National Counter Terrorism Authority</h2>
        <p className="text-base text-emerald-100/80">Attendance Management System</p>
        <div className="h-px w-16 bg-emerald-300/40" aria-hidden="true" />
      </div>

      <p className="relative max-w-sm text-xs leading-relaxed text-emerald-100/65">Authorised use only. Activity is monitored and logged.</p>
    </div>
  );
}

/** Below 900px the brand panel becomes a compact header band. */
export function BrandBand() {
  return (
    <div className="relative isolate flex items-center gap-3 overflow-hidden bg-[#064e3b] bg-[radial-gradient(120%_200%_at_0%_0%,#0b6a4e_0%,#064e3b_50%,#04251c_100%)] px-5 py-4 text-white">
      <ContourPattern className="opacity-80" />
      <BrandMark className="relative size-10 drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)]" />
      <div className="relative min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold">National Counter Terrorism Authority</p>
        <p className="truncate text-xs text-emerald-100/75">Attendance Management System</p>
      </div>
    </div>
  );
}
