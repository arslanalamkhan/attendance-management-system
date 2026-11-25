import { toast } from 'sonner';
import { Cpu, UserCheck, Users } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Page } from '@nacta/shared';
import { AreaTrendChart } from '../../components/charts/area-trend-chart';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState, type TableQuery } from '../../components/data-table/use-data-table-state';
import { Avatar } from '../../components/ui/avatar';
import { Badge, StatusPill } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatCard } from '../../components/ui/stat-card';
import { Section } from './section';

interface MockEmployee {
  id: number;
  empCode: string;
  name: string;
  wing: string;
  designation: string;
  status: 'present' | 'late' | 'absent' | 'leave';
  devices: number;
}

const FIRST = ['Ayesha', 'Bilal', 'Chaudhry', 'Dania', 'Eman', 'Farhan', 'Gulnaz', 'Hamza', 'Iqra', 'Junaid', 'Kiran', 'Laiba'];
const LAST = ['Khan', 'Ahmed', 'Malik', 'Raza', 'Siddiqui', 'Noor', 'Hussain', 'Butt', 'Qureshi', 'Javed'];
const WINGS = ['Administration', 'Operations', 'Intelligence Coordination', 'Policy & Research', 'Information Technology', 'Finance'];
const TITLES = ['Director', 'Deputy Director', 'Assistant Director', 'Analyst', 'Section Officer', 'Clerk'];
const STATUSES: MockEmployee['status'][] = ['present', 'present', 'present', 'late', 'absent', 'leave'];

const MOCK: MockEmployee[] = Array.from({ length: 137 }, (_, i) => ({
  id: i + 1,
  empCode: String(100 + i * 7),
  name: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
  wing: WINGS[(i * 5) % WINGS.length] ?? 'Administration',
  designation: TITLES[(i * 2) % TITLES.length] ?? 'Clerk',
  status: STATUSES[(i * 7) % STATUSES.length] ?? 'present',
  devices: 1 + (i % 3),
}));

type MockFilter = 'q' | 'wing' | 'status';

/** Stands in for a server: filters, sorts and slices like GET /employees would. */
async function fetchMock(q: TableQuery<MockFilter>): Promise<Page<MockEmployee>> {
  await new Promise((r) => window.setTimeout(r, 350));
  let rows = MOCK.filter(
    (e) =>
      (!q.q || `${e.name} ${e.empCode}`.toLowerCase().includes(q.q.toLowerCase())) &&
      (!q.wing || e.wing === q.wing) &&
      (!q.status || e.status === q.status),
  );
  const dir = q.order === 'desc' ? -1 : 1;
  const key = q.sort;
  if (key === 'empCode') rows = [...rows].sort((a, b) => (Number(a.empCode) - Number(b.empCode)) * dir);
  else if (key === 'name' || key === 'wing' || key === 'designation' || key === 'status')
    rows = [...rows].sort((a, b) => a[key].localeCompare(b[key]) * dir);
  const start = (q.page - 1) * q.pageSize;
  return { items: rows.slice(start, start + q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize };
}

const statusTone = { present: 'success', late: 'warning', absent: 'danger', leave: 'info' } as const;
const statusLabel = { present: 'Present', late: 'Late', absent: 'Absent', leave: 'On leave' } as const;

const columns: ColumnDef<MockEmployee>[] = [
  { id: 'empCode', accessorKey: 'empCode', header: 'Code', meta: { label: 'Code', className: 'w-28' }, cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.empCode}</span> },
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Employee',
    meta: { label: 'Employee' },
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <Avatar name={row.original.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.designation}</p>
        </div>
      </div>
    ),
  },
  { id: 'wing', accessorKey: 'wing', header: 'Wing', meta: { label: 'Wing' } },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Today',
    meta: { label: 'Today' },
    cell: ({ row }) => <StatusPill tone={statusTone[row.original.status]}>{statusLabel[row.original.status]}</StatusPill>,
  },
  { id: 'devices', header: 'Devices', meta: { label: 'Devices', align: 'right' }, cell: ({ row }) => <Badge tone="outline">{row.original.devices}</Badge> },
];

function DataTableDemo() {
  const state = useDataTableState<MockFilter>({ filterKeys: ['q', 'wing', 'status'], defaultPageSize: 10, defaultSort: { id: 'empCode', desc: false } });
  const result = useDataTableQuery<MockEmployee, MockFilter>({
    state,
    queryKey: (q) => ['design', 'employees', q],
    fetcher: (q) => fetchMock(q),
  });
  return (
    <DataTable<MockEmployee>
      id="design-employees"
      caption="Employees (mock data)"
      columns={columns}
      data={result.data?.items ?? []}
      total={result.data?.total ?? 0}
      state={state}
      getRowId={(r) => String(r.id)}
      loading={result.isPending}
      fetching={result.isFetching}
      error={result.error}
      onRetry={() => void result.refetch()}
      onRowClick={(r) => toast(`Opened ${r.name}`, { description: `Code ${r.empCode}` })}
      selectable
      noun={{ singular: 'employee', plural: 'employees' }}
      maxHeight="26rem"
      toolbar={
        <>
          <DataTableSearch value={state.filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search name or code..." label="Search employees" />
          <DataTableFilterSelect label="Wing" value={state.filters.wing} onChange={(v) => state.setFilter('wing', v)} options={WINGS.map((w) => ({ value: w, label: w }))} />
          <DataTableFilterSelect
            label="Today"
            value={state.filters.status}
            onChange={(v) => state.setFilter('status', v)}
            options={(Object.keys(statusLabel) as MockEmployee['status'][]).map((s) => ({ value: s, label: statusLabel[s] }))}
          />
        </>
      }
      bulkActions={({ rows, clear }) => (
        <>
          <Button size="sm" variant="secondary" onClick={() => toast.success(`Pushed ${rows.length} to devices (demo)`)}>
            Push to devices
          </Button>
          <Button size="sm" variant="destructive-ghost" onClick={clear}>
            Deselect
          </Button>
        </>
      )}
    />
  );
}

const TREND = [212, 224, 219, 231, 228, 120, 98, 233, 240, 236, 241, 238, 119, 244].map((v, i) => ({
  label: `${i + 1} Nov`,
  fullLabel: `${i + 1} November`,
  value: v,
}));

export function DataSection() {
  return (
    <>
      <Section id="stats" title="Stat cards and charts" description="Headline numbers with context. Sparklines are decorative; the value is always text.">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Devices online" icon={<Cpu />} value={3} unit="of 4" footnote="1 not reporting" />
            <StatCard label="Present today" icon={<UserCheck />} value="238" unit="of 261" delta={{ value: -6, label: 'vs yesterday' }} sparkline={TREND.map((t) => t.value)} />
            <StatCard label="Employees" icon={<Users />} value="817" delta={{ value: 12, label: 'this month' }} />
            <StatCard label="Loading state" value={0} loading />
          </div>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Presence, last 14 days</CardTitle>
                <CardDescription>Area chart on the chart tokens.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <AreaTrendChart data={TREND} seriesLabel="Present" ariaLabel="Mock presence trend" />
            </CardContent>
          </Card>
        </div>
      </Section>
      <Section id="datatable" title="Data table" description="Server-side pagination, sort and filters synced to the URL. Try sorting, filtering, selecting rows, the Columns menu, density, and arrow keys + Enter on a row.">
        <DataTableDemo />
      </Section>
    </>
  );
}

