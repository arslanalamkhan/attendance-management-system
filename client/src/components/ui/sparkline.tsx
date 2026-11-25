import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SparklineProps {
  data: number[];
  className?: string;
  /** Tailwind text colour class; the line uses currentColor. */
  strokeClassName?: string;
  height?: number;
}

/** Tiny dependency-free trend line. Decorative: the value it summarises is always shown in text. */
export function Sparkline({ data, className, strokeClassName = 'text-primary', height = 36 }: SparklineProps) {
  const id = React.useId();
  if (data.length < 2) return <div style={{ height }} className={className} aria-hidden="true" />;
  const w = 120;
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full overflow-visible', strokeClassName, className)}
      style={{ height }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.25" fill="currentColor" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
