import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Printer, UserSearch } from 'lucide-react';
import { REPORT_TYPES, REPORT_TYPE_KEYS, reportPermission } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import type { ReportType } from '@nacta/shared';
import { getReport } from '../../lib/endpoints/reports';
import { qk } from '../../lib/query-keys';
import { missingParams, readReportParams } from '../../lib/report-ui';
import { usePageMeta } from '../../hooks/use-page-meta';
import { ReportExportButtons } from '../../components/reports/export-buttons';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
import { TimingSetupBanner } from '../../components/rules/setup-banner';
import { ParamBar, type ParamPatch } from './ParamBar';
import { RegisterGrid } from './RegisterGrid';
import { ReportPager, ReportTable } from './ReportTable';
import { REPORT_ICON } from './report-meta';

const PAGE_SIZES = [25, 50, 100, 200, 500];

function Highlights({ items, loading }: { items?: { label: string; value: string }[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="mb-4 flex flex-wrap gap-3" aria-busy="true" aria-label="Loading highlights">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[62px] w-36" />
        ))}
      </div>
    );
  }
  if (!items || items.length === 0) return null;
  return (
    <dl aria-label="Highlights" className="mb-4 flex flex-wrap gap-3">
      {items.map((h) => (
        <div key={h.label} className="min-w-[8.5rem] rounded-lg border bg-card px-4 py-2.5 shadow-xs">
          <dt className="text-xs font-medium text-muted-foreground">{h.label}</dt>
          <dd className="font-figure mt-0.5 text-xl font-semibold leading-tight tracking-tight">{h.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportView({ type }: { type: ReportType }) {
  const meta = REPORT_TYPES[type];
  usePageMeta({ title: meta.label });
  const [sp, setSp] = useSearchParams();
  const params = React.useMemo(() => readReportParams(type, sp), [type, sp]);
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '', 10) || 1);
  const rawSize = Number.parseInt(sp.get('pageSize') ?? '', 10);
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : 100;
  const missing = missingParams(type, params);
  const query = { ...params, page, pageSize };

  const result = useQuery({
    queryKey: qk.reports.run(type, query),
    queryFn: ({ signal }) => getReport(type, query, signal),
    enabled: missing.length === 0,
    placeholderData: keepPreviousData,
  });

  const change = React.useCallback(
    (patch: ParamPatch) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  const setPage = (p: number) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete('page');
      else next.set('page', String(p));
      return next;
    });
  const setPageSize = (n: number) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('pageSize', String(n));
      next.delete('page');
      return next;
    });

  const Icon = REPORT_ICON[type];
  const data = missing.length === 0 ? result.data : undefined;
  const loading = missing.length === 0 && result.isPending;
  const isRegister = type === 'monthly_register';

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Reports', to: '/reports' }, { label: meta.label }]}
        title={data?.title ?? meta.label}
        description={data?.subtitle ?? meta.description}
        meta={
          <span className="grid size-7 place-content-center rounded-md bg-primary-subtle text-primary-text print:hidden [&_svg]:size-4" aria-hidden="true">
            <Icon />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="ghost" size="md" onClick={() => window.print()} aria-label="Print this report">
              <Printer aria-hidden="true" />
              Print
            </Button>
            <ReportExportButtons type={type} params={params} blocked={missing[0]?.message} />
          </div>
        }
      />
      <TimingSetupBanner className="print:hidden" />
      <div className="print:hidden">
        <ParamBar type={type} params={params} onChange={change} />
      </div>

      {missing.length > 0 ? (
        <EmptyState
          icon={<UserSearch />}
          title={missing[0]!.message}
          description="This report needs one more choice before it can run. Pick it in the bar above."
        />
      ) : result.isError && !data ? (
        <ErrorState title="This report could not be loaded" error={result.error} onRetry={() => void result.refetch()} retrying={result.isFetching} />
      ) : (
        <>
          <Highlights items={result.data?.highlights} loading={loading} />
          {isRegister ? <RegisterGrid result={result.data} loading={loading} fetching={result.isFetching} /> : <ReportTable result={result.data} loading={loading} fetching={result.isFetching} />}
          {result.data && <ReportPager page={result.data.page} pageSize={result.data.pageSize} total={result.data.total} onPage={setPage} onPageSize={setPageSize} fetching={result.isFetching} />}
          {result.data && (
            <p className="mt-2 text-xs text-muted-foreground print:mt-4">
              Generated {new Date(result.data.generatedAt).toLocaleString('en-GB')}. Downloads contain every row, not just this page.
            </p>
          )}
        </>
      )}
    </>
  );
}

/** /reports/:type */
export default function ReportPage() {
  const { type } = useParams();
  if (!type || !(REPORT_TYPE_KEYS as string[]).includes(type)) {
    return (
      <EmptyState
        className="mt-10"
        title="Unknown report"
        description="That report does not exist. Choose one from the gallery."
        action={
          <Button asChild>
            <Link to="/reports">All reports</Link>
          </Button>
        }
      />
    );
  }
  return <AllowedReport type={type as ReportType} />;
}

/** Each report is granted on its own: without reports.<type> the page explains instead of failing on a 403. */
function AllowedReport({ type }: { type: ReportType }) {
  const { can } = useAuth();
  if (!can(reportPermission(type))) {
    return (
      <EmptyState
        className="mt-10"
        title="This report is not part of your role"
        description={`Ask a Super Admin to add "${REPORT_TYPES[type].label}" to your role.`}
        action={
          <Button asChild>
            <Link to="/reports">All reports</Link>
          </Button>
        }
      />
    );
  }
  return <ReportView key={type} type={type} />;
}
