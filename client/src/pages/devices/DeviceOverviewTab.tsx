import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import type { AttendanceQuery, Device } from '@nacta/shared';
import { PunchStatusLabel, VerifyTypeLabel } from '@nacta/shared';
import { listAttendance } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/skeleton';
import { absoluteTime } from '../../lib/time';
import { Count, Dash, RelativeTime } from './parts';

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

const text = (v: string | null) => (v ? v : <Dash />);
const mono = (v: string | null) => (v ? <span className="font-mono text-[13px]">{v}</span> : <Dash />);

function InfoGrid({ device }: { device: Device }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Hardware and firmware</CardTitle>
            <CardDescription>As reported by the terminal. Use Refresh info to update.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <InfoItem label="Serial number">{mono(device.serialNumber)}</InfoItem>
            <InfoItem label="Model">{text(device.deviceName)}</InfoItem>
            <InfoItem label="Platform">{text(device.platform)}</InfoItem>
            <InfoItem label="Firmware">{mono(device.firmwareVersion)}</InfoItem>
            <InfoItem label="Push version">{mono(device.pushVersion)}</InfoItem>
            <InfoItem label="Last IP">{mono(device.ipAddress)}</InfoItem>
            <InfoItem label="Location">{text(device.location)}</InfoItem>
            <InfoItem label="Last seen">
              {device.lastSeenAt ? (
                <span title={absoluteTime(device.lastSeenAt)}>
                  <RelativeTime iso={device.lastSeenAt} />
                </span>
              ) : (
                <span className="text-muted-foreground">Never</span>
              )}
            </InfoItem>
            <InfoItem label="Registered">
              <span className="font-figure">{new Date(device.createdAt).toLocaleDateString()}</span>
              {device.autoRegistered && (
                <Badge tone="info" className="ml-2">
                  Auto
                </Badge>
              )}
            </InfoItem>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Stored on device</CardTitle>
            <CardDescription>Counts reported by the terminal.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            {(
              [
                ['Users', device.userCount],
                ['Faces', device.faceCount],
                ['Fingerprints', device.fpCount],
                ['Attendance logs', device.attCount],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight">
                  <Count value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function RecentPunches({ device }: { device: Device }) {
  const q: AttendanceQuery = { deviceId: device.id, page: 1, pageSize: 20 };
  const punches = useQuery({
    queryKey: qk.attendance.list(q),
    queryFn: ({ signal }) => listAttendance(q, signal),
    refetchInterval: 10_000,
  });
  const rows = punches.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recent punches</CardTitle>
          <CardDescription>The last 20 records received from this device.</CardDescription>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to={`/attendance?deviceId=${device.id}`}>View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-0 pt-4">
        {punches.isPending ? (
          <div className="space-y-2 px-5 pb-5" aria-busy="true" aria-label="Loading punches">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : punches.isError ? (
          <ErrorState bare error={punches.error} onRetry={() => void punches.refetch()} retrying={punches.isFetching} />
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            icon={<CalendarCheck />}
            title="No punches from this device yet"
            description="Attendance records appear here as soon as someone punches in or out."
          />
        ) : (
          <div className="overflow-x-auto border-t">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Last 20 punches from {device.name}</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {['Time', 'PIN', 'Employee', 'Event', 'Method'].map((h) => (
                    <th key={h} scope="col" className="h-9 whitespace-nowrap border-b bg-muted px-5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-muted/60">
                    <td className="whitespace-nowrap border-b px-5 py-2 font-mono text-[13px] tabular-nums group-last:border-b-0">{r.punchTime}</td>
                    <td className="border-b px-5 py-2 font-mono text-[13px] tabular-nums">{r.pin}</td>
                    <td className="border-b px-5 py-2">
                      {r.employeeId !== null ? (
                        <Link
                          to={`/employees/${r.employeeId}`}
                          className="rounded-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {r.employeeName ?? `Employee ${r.employeeId}`}
                        </Link>
                      ) : (
                        <Badge tone="outline">Unmatched</Badge>
                      )}
                    </td>
                    <td className="border-b px-5 py-2 text-muted-foreground">{r.status === null ? '-' : (PunchStatusLabel[r.status] ?? r.status)}</td>
                    <td className="border-b px-5 py-2 text-muted-foreground">{r.verifyType === null ? '-' : (VerifyTypeLabel[r.verifyType] ?? r.verifyType)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DeviceOverviewTab({ device }: { device: Device }) {
  return (
    <div className="space-y-4">
      <InfoGrid device={device} />
      <RecentPunches device={device} />
    </div>
  );
}
