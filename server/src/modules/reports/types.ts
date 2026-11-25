import type { ReportColumn, ReportType, StatusCell, WingScope } from '@nacta/shared';

export type Row = Record<string, unknown>;

/** A secondary table (a second sheet in Excel, a second section in the PDF). Not part of the on-screen contract. */
export interface ReportTable {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: Row[];
  totals: Row | null;
}

/** A report before paging: everything the screen, Excel and PDF renderers need. */
export interface ReportData {
  type: ReportType;
  title: string;
  subtitle: string;
  /** "Wing: Operations Wing | Section: All" for the file header. */
  filters: string;
  columns: ReportColumn[];
  rows: Row[];
  /** Real row count (differs from rows.length only when a screen page was requested). */
  total: number;
  totals: Row | null;
  highlights: { label: string; value: string }[];
  legend: StatusCell[];
  /** Day columns that are weekends / holidays for everyone (monthly register shading). */
  columnShade: Record<string, 'weekend' | 'holiday'>;
  extraTables: ReportTable[];
  /** Parts of the file name: NACTA-<label>-<scope>-<period>. */
  file: { label: string; scope: string; period: string };
}

export interface ReportContext {
  scope: WingScope;
  /** The Super Admin may see the "Corrected" marker; nobody else may. */
  isSuperAdmin: boolean;
}

/** Fully resolved parameters (defaults filled in, ranges checked). */
export interface ReportParams {
  date: string;
  month: string;
  from: string;
  to: string;
  wingId: number | undefined;
  sectionId: number | undefined;
  employeeId: number | undefined;
  deviceId: number | undefined;
  leaveTypeId: number | undefined;
  status: string | undefined;
  /** Name / code search (daily and punch_log; not part of the shared param list). */
  q: string | undefined;
  minLateMinutes: number;
  page: number;
  pageSize: number;
}

export interface Generator {
  name: string;
  at: Date;
}
