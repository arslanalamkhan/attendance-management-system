import * as React from 'react';
import { Fingerprint, Plus, Trash2 } from 'lucide-react';
import { FINGERS } from '@nacta/shared';
import type { BiometricTemplate } from '@nacta/shared';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Tooltip } from '../../../components/ui/tooltip';
import { fingerName, longDay, sourceLabel, templateSummary, versionLabel } from './bio-utils';

// ---------------------------------------------------------------------------
// Geometry. One left hand (palm toward the viewer, thumb pointing inward) drawn in a 280x300 box;
// the right hand is the same drawing mirrored. Local finger order: little, ring, middle, index, thumb.
// ---------------------------------------------------------------------------
const W = 600;
const H = 300;
const FINGER_BOTTOM = 204;

interface LocalFinger {
  x: number;
  top: number;
  w: number;
}
const LOCAL: LocalFinger[] = [
  { x: 22, top: 114, w: 34 }, // little
  { x: 62, top: 74, w: 36 }, // ring
  { x: 104, top: 58, w: 38 }, // middle
  { x: 148, top: 78, w: 36 }, // index
];
const THUMB = { baseX: 176, baseY: 262, len: 128, w: 38, angle: 36 };

const PALM = 'M22,190 H184 V250 Q184,292 142,292 H64 Q22,292 22,250 Z';

/** FINGERS index -> which local drawing it uses and on which hand. */
function localOf(index: number): { local: number; right: boolean } {
  return index <= 4 ? { local: index, right: false } : { local: 9 - index, right: true };
}

function fingerPath(f: LocalFinger): { fill: string; edge: string; cx: number; cy: number } {
  const r = f.w / 2;
  const x2 = f.x + f.w;
  return {
    fill: `M${f.x},${FINGER_BOTTOM} V${f.top + r} A${r},${r} 0 0 1 ${x2},${f.top + r} V${FINGER_BOTTOM} Z`,
    edge: `M${f.x},${FINGER_BOTTOM} V${f.top + r} A${r},${r} 0 0 1 ${x2},${f.top + r} V${FINGER_BOTTOM}`,
    cx: f.x + r,
    cy: f.top + 30,
  };
}

/** Bounding box (in the 600x300 space) of the clickable button for a finger. */
function hitBox(index: number): { x: number; y: number; w: number; h: number } {
  const { local, right } = localOf(index);
  let x: number;
  let y: number;
  let w: number;
  let h: number;
  if (local === 4) {
    x = 196;
    y = 112;
    w = 80;
    h = 112;
  } else {
    const f = LOCAL[local]!;
    x = f.x - 1;
    y = f.top - 2;
    w = f.w + 2;
    h = 96;
  }
  return { x: right ? W - (x + w) : x, y, w, h };
}

const css = {
  palmFill: { fill: 'rgb(var(--muted))' },
  stroke: { stroke: 'rgb(var(--border-strong))' },
  on: { fill: 'rgb(var(--primary))', stroke: 'rgb(var(--primary))' },
  off: { fill: 'rgb(var(--muted))', stroke: 'rgb(var(--border-strong))' },
  hover: { fill: 'rgb(var(--primary-subtle))', stroke: 'rgb(var(--primary))' },
} as const;

function Whorl({ cx, cy, enrolled, rotate }: { cx: number; cy: number; enrolled: boolean; rotate?: string }) {
  const stroke = enrolled ? 'rgb(var(--primary-foreground))' : 'rgb(var(--border-strong))';
  return (
    <g transform={rotate} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" opacity={enrolled ? 0.7 : 0.9} aria-hidden="true">
      <path d={`M${cx - 11},${cy + 3} Q${cx - 11},${cy - 12} ${cx},${cy - 12} Q${cx + 11},${cy - 12} ${cx + 11},${cy + 3}`} />
      <path d={`M${cx - 7},${cy + 4} Q${cx - 7},${cy - 7} ${cx},${cy - 7} Q${cx + 7},${cy - 7} ${cx + 7},${cy + 4}`} />
      <path d={`M${cx - 3},${cy + 5} Q${cx - 3},${cy - 2} ${cx},${cy - 2} Q${cx + 3},${cy - 2} ${cx + 3},${cy + 5}`} />
    </g>
  );
}

function HandArt({ fingers, hover, right }: { fingers: Map<number, BiometricTemplate>; hover: number | null; right: boolean }) {
  const idxOf = (local: number) => (right ? 9 - local : local);
  const thumbIdx = idxOf(4);
  const style = (idx: number) => (fingers.has(idx) ? css.on : hover === idx ? css.hover : css.off);
  const t = THUMB;
  const thumbOn = fingers.has(thumbIdx);
  return (
    <g strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
      <path d={PALM} style={{ ...css.palmFill, ...css.stroke }} />
      {/* creases */}
      <g fill="none" style={css.stroke} strokeWidth={1.4} opacity={0.55} aria-hidden="true">
        <path d="M44,238 Q96,224 150,244" />
        <path d="M52,262 Q96,252 140,266" />
      </g>
      {/* thumb */}
      <g transform={`rotate(${t.angle} ${t.baseX} ${t.baseY})`}>
        <rect x={t.baseX - t.w / 2} y={t.baseY - t.len} width={t.w} height={t.len} rx={t.w / 2} style={style(thumbIdx)} />
        <Whorl cx={t.baseX} cy={t.baseY - t.len + 30} enrolled={thumbOn} />
      </g>
      {/* fingers */}
      {LOCAL.map((f, local) => {
        const idx = idxOf(local);
        const p = fingerPath(f);
        const s = style(idx);
        return (
          <g key={local}>
            <path d={p.fill} style={{ fill: s.fill }} stroke="none" />
            <path d={p.edge} fill="none" style={{ stroke: s.stroke }} />
            <Whorl cx={p.cx} cy={p.cy} enrolled={fingers.has(idx)} />
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Interactive diagram
// ---------------------------------------------------------------------------
export interface HandsDiagramProps {
  fingers: Map<number, BiometricTemplate>;
  canEdit: boolean;
  onEnrol: (fingerIndex: number) => void;
  onDelete: (template: BiometricTemplate) => void;
  className?: string;
}

export function HandsDiagram({ fingers, canEdit, onEnrol, onDelete, className }: HandsDiagramProps) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  const active = hover ?? open;
  return (
    <div className={cn('mx-auto w-full max-w-[560px]', className)}>
      <div className="relative" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" role="presentation" aria-hidden="true">
          <HandArt fingers={fingers} hover={active} right={false} />
          <g transform={`translate(${W},0) scale(-1,1)`}>
            <HandArt fingers={fingers} hover={active} right />
          </g>
        </svg>
        {FINGERS.map((f) => {
          const box = hitBox(f.index);
          const tpl = fingers.get(f.index);
          const label = tpl ? templateSummary(f.name, tpl) : `${f.name} · not enrolled`;
          return (
            <Popover key={f.index} open={open === f.index} onOpenChange={(o) => setOpen(o ? f.index : null)}>
              <Tooltip content={label} side="top">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${f.name}, ${tpl ? 'enrolled' : 'not enrolled'}`}
                    onMouseEnter={() => setHover(f.index)}
                    onMouseLeave={() => setHover((h) => (h === f.index ? null : h))}
                    onFocus={() => setHover(f.index)}
                    onBlur={() => setHover((h) => (h === f.index ? null : h))}
                    className="absolute cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    style={{ left: `${(box.x / W) * 100}%`, top: `${(box.y / H) * 100}%`, width: `${(box.w / W) * 100}%`, height: `${(box.h / H) * 100}%` }}
                  />
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent side="bottom" align="center" className="w-72">
                <FingerPopover
                  index={f.index}
                  template={tpl}
                  canEdit={canEdit}
                  onEnrol={() => {
                    setOpen(null);
                    onEnrol(f.index);
                  }}
                  onDelete={() => {
                    setOpen(null);
                    if (tpl) onDelete(tpl);
                  }}
                />
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between px-[8%] text-xs font-medium text-muted-foreground" aria-hidden="true">
        <span>Left hand</span>
        <span>Right hand</span>
      </div>
    </div>
  );
}

function FingerPopover({
  index,
  template,
  canEdit,
  onEnrol,
  onDelete,
}: {
  index: number;
  template: BiometricTemplate | undefined;
  canEdit: boolean;
  onEnrol: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-5',
            template ? 'bg-primary text-primary-foreground' : 'border border-dashed border-border-strong text-muted-foreground',
          )}
          aria-hidden="true"
        >
          <Fingerprint />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{fingerName(index)}</p>
          {template ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Enrolled · {versionLabel(template.version)}
              <br />
              {sourceLabel(template.source, template.sourceDeviceName)} · {longDay(template.updatedAt)}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Not enrolled yet.</p>
          )}
        </div>
      </div>
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <Button size="sm" variant={template ? 'secondary' : 'primary'} onClick={onEnrol}>
            <Plus aria-hidden="true" />
            {template ? 'Re-enrol on device…' : 'Enrol on device…'}
          </Button>
          {template && (
            <Button size="sm" variant="destructive-ghost" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              Delete…
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">You don&apos;t have permission to enrol biometrics.</p>
      )}
    </div>
  );
}
