import { createRequire } from 'node:module';
import path from 'node:path';
import pdfmake from 'pdfmake';
import type { ReportColumn, StatusCell } from '@nacta/shared';
import { logoDataUri } from './assets';
import { fmtDate, fmtGenerated, ink, legendLabel, tint } from './common';
import type { Generator, ReportData, ReportTable, Row } from './types';

export const PDF_MIME = 'application/pdf';
const GREEN = '#065F46';
const ORG = 'National Counter Terrorism Authority';

// ---- fonts: the Roboto files bundled with pdfmake, resolved from node_modules at run time (works from src and dist) ----
let fontsReady = false;
function setupPdfmake(): void {
  if (fontsReady) return;
  const req = createRequire(import.meta.url);
  const dir = path.join(path.dirname(req.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  pdfmake.setFonts({
    Roboto: {
      normal: path.join(dir, 'Roboto-Regular.ttf'),
      bold: path.join(dir, 'Roboto-Medium.ttf'),
      italics: path.join(dir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(dir, 'Roboto-MediumItalic.ttf'),
    },
  });
  // Nothing is fetched from the network; the file system is readable only inside the font folder.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(path.resolve(dir)));
  fontsReady = true;
}

const isStatusCell = (v: unknown): v is StatusCell => typeof v === 'object' && v !== null && 'code' in v && 'label' in v;
const numeric = (c: ReportColumn): boolean => c.kind === 'number' || c.kind === 'minutes' || c.kind === 'hours' || c.kind === 'percent';
const hex = (rrggbb: string): string => `#${rrggbb}`;

function text(c: ReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.kind) {
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : String(v);
    case 'hours': {
      // decimal hours -> "h:mm" (6.62 -> "6:37")
      const mins = Math.round(Number(v) * 60);
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
    case 'percent': return `${Number(v).toFixed(1)}%`;
    case 'minutes':
    case 'number': return String(v);
    default: return typeof v === 'object' ? '' : String(v);
  }
}

const STAR: Record<string, number> = { name: 1.7, wing: 1.2, section: 1.2, designation: 1.3, note: 2, reason: 2, dates: 2.2, leaveTypes: 1.4 };

export function widthsFor(columns: ReportColumn[], fs: number, available: number): (number | string)[] {
  const k = fs / 8;
  const fixed = columns.map((c): number | null => {
    switch (c.kind) {
      case 'day_code': return 11.4;
      case 'mono': return 46 * k;
      case 'date': return 58 * k;
      case 'time': return 40 * k;
      case 'minutes':
      case 'hours': return 42 * k;
      case 'percent': return 46 * k;
      case 'number':
        // monthly register totals: absolute (they are laid out at 6pt)
        if (c.key === 'tWorking') return 31;
        if (c.key === 'tLeave') return 25;
        if (/^t(P|L|HM|A)$/.test(c.key)) return 19;
        return 46 * k;
      case 'status': return 112 * k;
      default: return null;
    }
  });
  const fixedSum = fixed.reduce<number>((s, w) => s + (w ?? 0), 0);
  const stars = columns.map((c, i) => (fixed[i] === null ? (STAR[c.key] ?? 1) : 0));
  const starSum = stars.reduce((s, w) => s + w, 0);
  let scale = 1;
  const wantStar = starSum * 40; // keep text columns at least ~40pt per star unit
  if (fixedSum + wantStar > available) scale = Math.max(0.6, (available - wantStar) / fixedSum);
  // Every width is a number: the text columns share what the fixed ones leave over, in proportion to their weights.
  const left = Math.max(available - fixedSum * scale, starSum * 30);
  return columns.map((_c, i) => {
    const f = fixed[i];
    if (f === null || f === undefined) return Math.floor(((stars[i] as number) / starSum) * left * 10) / 10;
    return Math.round(f * scale * 10) / 10;
  });
}

interface TableOpts {
  columns: ReportColumn[];
  rows: Row[];
  totals: Row | null;
  shade: Record<string, 'weekend' | 'holiday'>;
  fontSize: number;
  compact: boolean;
}

function buildTable(o: TableOpts, available: number): Record<string, unknown> {
  const { columns, fontSize: fs } = o;
  const hasGroup = columns.some((c) => c.group);
  const headerRows = hasGroup ? 2 : 1;
  const headFont = fs <= 6.5 ? 6 : fs;
  const offColor = (k?: 'weekend' | 'holiday') => (k === 'weekend' ? '#475569' : k === 'holiday' ? '#0E7490' : GREEN);

  const body: unknown[][] = [];
  if (hasGroup) {
    body.push(
      columns.map((c) => ({
        text: c.group ?? '',
        alignment: 'center',
        bold: true,
        fontSize: 5.5,
        color: '#D1FAE5',
        fillColor: offColor(o.shade[c.key]),
      })),
    );
  }
  body.push(
    columns.map((c) => ({
      text: c.label,
      bold: true,
      color: '#FFFFFF',
      fontSize: c.kind === 'day_code' ? 6 : headFont,
      alignment: c.kind === 'day_code' || c.align === 'center' ? 'center' : numeric(c) ? 'right' : 'left',
      fillColor: c.kind === 'day_code' ? offColor(o.shade[c.key]) : GREEN,
    })),
  );

  for (const r of o.rows) {
    body.push(
      columns.map((c) => {
        const v = r[c.key];
        if ((c.kind === 'status' || c.kind === 'day_code') && isStatusCell(v)) {
          const color = v.color ?? '#64748B';
          return {
            text: c.kind === 'day_code' ? v.code : v.label,
            alignment: c.kind === 'day_code' ? 'center' : 'left',
            bold: true,
            fontSize: c.kind === 'day_code' ? 6 : fs,
            color: hex(ink(color)),
            fillColor: hex(tint(color)),
          };
        }
        const shade = o.shade[c.key];
        return {
          text: text(c, v),
          alignment: c.kind === 'day_code' || c.align === 'center' || c.kind === 'time' ? 'center' : numeric(c) ? 'right' : 'left',
          fontSize: c.kind === 'day_code' ? 6 : fs,
          ...(c.kind === 'day_code' && typeof v === 'number' ? { bold: true } : {}),
          ...(shade ? { fillColor: shade === 'weekend' ? '#E2E8F0' : '#CFFAFE' } : {}),
        };
      }),
    );
  }
  let totalsIndex = -1;
  if (o.totals) {
    totalsIndex = body.length;
    const labelKey = columns.find((c) => c.kind === 'text' || c.kind === 'mono' || c.kind === 'date')?.key;
    body.push(
      columns.map((c) => {
        const v = o.totals?.[c.key];
        const shown = v === undefined || v === null ? (c.key === labelKey ? 'Total' : '') : text(c, v);
        return {
          text: shown,
          bold: true,
          fontSize: c.kind === 'day_code' ? 6 : fs,
          color: '#064E3B',
          fillColor: '#D1FAE5',
          alignment: c.kind === 'day_code' ? 'center' : numeric(c) ? 'right' : 'left',
        };
      }),
    );
  }

  const pad = o.compact ? 1.6 : 3;
  const padH = o.compact ? 1 : 4;
  return {
    // pdfmake adds the cell padding on top of numeric widths, so the budget for content is what the paddings leave.
    table: { headerRows, widths: widthsFor(columns, fs, available - columns.length * 2 * padH), body, dontBreakRows: true },
    layout: {
      hLineWidth: (i: number) => (i === totalsIndex ? 1.2 : i === 0 || i === headerRows ? 0 : 0.4),
      hLineColor: (i: number) => (i === totalsIndex ? GREEN : '#E5E7EB'),
      vLineWidth: () => 0,
      paddingLeft: () => padH,
      paddingRight: () => padH,
      paddingTop: () => pad,
      paddingBottom: () => pad,
      fillColor: (i: number) => (i >= headerRows && i !== totalsIndex && (i - headerRows) % 2 === 1 ? '#F6F8F9' : null),
    },
  };
}

function highlightsBlock(h: { label: string; value: string }[]): Record<string, unknown> | null {
  if (!h.length) return null;
  const per = Math.min(h.length, 7);
  const rows: unknown[][] = [];
  for (let i = 0; i < h.length; i += per) {
    const chunk = h.slice(i, i + per);
    while (chunk.length < per) chunk.push({ label: '', value: '' });
    rows.push(
      chunk.map((x) => ({
        stack: x.label || x.value
          ? [
              { text: x.label.toUpperCase(), fontSize: 6.3, color: '#4B5563', bold: true, characterSpacing: 0.3 },
              { text: x.value, fontSize: 13, bold: true, color: GREEN, margin: [0, 1, 0, 0] },
            ]
          : [],
        fillColor: x.label ? '#F0FDF4' : null,
        margin: [4, 2, 4, 2],
      })),
    );
  }
  return {
    table: { widths: Array.from({ length: per }, () => '*'), body: rows },
    layout: { hLineWidth: () => 3, vLineWidth: () => 3, hLineColor: () => '#FFFFFF', vLineColor: () => '#FFFFFF', paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    margin: [0, 2, 0, 8],
  };
}

function legendBlock(legend: StatusCell[]): Record<string, unknown>[] {
  if (!legend.length) return [];
  const per = 4;
  const rows: unknown[][] = [];
  for (let i = 0; i < legend.length; i += per) {
    const chunk = legend.slice(i, i + per);
    const cells: unknown[] = [];
    for (let j = 0; j < per; j++) {
      const l = chunk[j];
      if (!l) {
        cells.push({ text: '' }, { text: '' });
        continue;
      }
      const color = l.color ?? '#64748B';
      cells.push(
        { text: l.code || '–', alignment: 'center', bold: true, fontSize: 7, color: hex(ink(color)), fillColor: hex(tint(color)) },
        { text: legendLabel(l), fontSize: 7.5, color: '#374151', margin: [3, 0, 0, 0] },
      );
    }
    rows.push(cells);
  }
  return [
    { text: 'Legend', bold: true, fontSize: 8.5, color: GREEN, margin: [0, 10, 0, 3], unbreakable: false },
    {
      table: { widths: Array.from({ length: per }, () => [26, '*']).flat(), body: rows, dontBreakRows: true },
      layout: { hLineWidth: () => 2, vLineWidth: () => 2, hLineColor: () => '#FFFFFF', vLineColor: () => '#FFFFFF', paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 1, paddingRight: () => 1 },
    },
  ];
}

/** The branded PDF (A4 landscape, header on every page, repeating table header, legend, "Page x of y" footer). */
export async function buildPdf(d: ReportData, gen: Generator): Promise<Buffer> {
  setupPdfmake();
  const margins = { left: 24, right: 24 };
  const available = 841.89 - margins.left - margins.right;
  const isRegister = d.type === 'monthly_register';
  const wide = d.columns.length;
  const fontSize = isRegister ? 6.2 : wide >= 13 ? 7 : wide >= 10 ? 7.5 : 8.5;

  const content: unknown[] = [];
  content.push({ text: d.filters, fontSize: 8, color: '#4B5563', margin: [0, 0, 0, 3] });
  const hl = highlightsBlock(d.highlights);
  if (hl) content.push(hl);
  content.push(buildTable({ columns: d.columns, rows: d.rows, totals: d.totals, shade: d.columnShade, fontSize, compact: isRegister }, available));
  if (!d.rows.length) content.push({ text: 'No records match the selected filters.', italics: true, fontSize: 9, color: '#6B7280', margin: [0, 8, 0, 0] });
  content.push(...legendBlock(d.legend));
  const extra = (t: ReportTable, first: boolean): unknown[] => [
    { text: t.title, bold: true, fontSize: 12, color: GREEN, margin: [0, 0, 0, 6], ...(first ? { pageBreak: 'before' } : {}) },
    buildTable({ columns: t.columns, rows: t.rows, totals: t.totals, shade: {}, fontSize: 8, compact: false }, available),
  ];
  d.extraTables.forEach((t, i) => content.push(...extra(t, i === 0)));
  content.push({
    text: `End of report · ${d.total.toLocaleString('en-US')} ${d.total === 1 ? 'record' : 'records'} · Confidential: for official use only`,
    fontSize: 7,
    italics: true,
    color: '#6B7280',
    margin: [0, 10, 0, 0],
  });

  const generated = `Generated by ${gen.name} on ${fmtGenerated(gen.at)}`;
  const doc = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [margins.left, 76, margins.right, 34],
    info: { title: `${d.title} – ${d.subtitle}`, author: 'NACTA Attendance', subject: d.title, creator: 'NACTA Attendance', producer: 'NACTA Attendance' },
    defaultStyle: { font: 'Roboto', fontSize: 8, color: '#111827' },
    images: { logo: logoDataUri() },
    header: () => ({
      margin: [margins.left, 14, margins.right, 0],
      stack: [
        {
          columns: [
            { image: 'logo', width: 42, height: 42 },
            {
              width: '*',
              margin: [9, 1, 0, 0],
              stack: [
                { text: ORG.toUpperCase(), fontSize: 7.5, bold: true, color: GREEN, characterSpacing: 0.7 },
                { text: d.title, fontSize: 15.5, bold: true, color: '#111827', margin: [0, 1, 0, 1] },
                { text: d.subtitle, fontSize: 8.5, color: '#374151' },
              ],
            },
            { width: 110, text: 'CONFIDENTIAL', alignment: 'right', fontSize: 7, bold: true, color: '#9CA3AF', characterSpacing: 1, margin: [0, 2, 0, 0] },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 4, x2: available, y2: 4, lineWidth: 1.6, lineColor: GREEN }] },
      ],
    }),
    footer: (page: number, pages: number) => ({
      margin: [margins.left, 0, margins.right, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: available, y2: 0, lineWidth: 0.5, lineColor: '#D1D5DB' }] },
        { text: `Page ${page} of ${pages}  ·  ${generated}  ·  Confidential`, alignment: 'center', fontSize: 7, color: '#6B7280', margin: [0, 5, 0, 0] },
      ],
    }),
    content,
  };
  return pdfmake.createPdf(doc).getBuffer();
}

