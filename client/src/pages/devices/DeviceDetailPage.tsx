import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Cpu, Pencil, Power, RefreshCw, ScanSearch, Trash2 } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { getDevice } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { usePageMeta } from '../../hooks/use-page-meta';
import { ActivityFeed } from '../../components/audit/activity-feed';
import { useAuth } from '../../lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Gate } from '../../components/auth/gate';
import { Badge, DeviceStatusPill } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { DeviceConfirmDialogs, useEnqueueCommand, type DeviceConfirm } from './device-actions';
import { DeviceCommandsTab } from './DeviceCommandsTab';
import { DeviceFormSheet } from './DeviceFormSheet';
import { DeviceOverviewTab } from './DeviceOverviewTab';
import { DeviceUsersTab } from './DeviceUsersTab';
import { RelativeTime } from './parts';

const TABS = ['overview', 'users', 'commands', 'activity'] as const;
type TabKey = (typeof TABS)[number];

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading device" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-80 max-w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 lg:col-span-2" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export default function DeviceDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const validId = Number.isInteger(id) && id > 0;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const { can } = useAuth();
  const canAudit = can('audit.view');
  const tab: TabKey = TABS.find((t) => t === tabParam && (t !== 'activity' || canAudit)) ?? 'overview';

  const query = useQuery({
    queryKey: qk.devices.detail(id),
    queryFn: ({ signal }) => getDevice(id, signal),
    enabled: validId,
    refetchInterval: 10_000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
  const enqueue = useEnqueueCommand();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<DeviceConfirm>(null);

  const device = query.data;
  usePageMeta({ title: 'Device', entityType: 'device', entityId: validId ? id : undefined, entityLabel: device?.name });

  const notFound = !validId || (query.error instanceof ApiError && query.error.status === 404);
  if (notFound) {
    return (
      <EmptyState
        icon={<Cpu />}
        title="Device not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild variant="secondary">
            <Link to="/devices">
              <ArrowLeft aria-hidden="true" />
              Back to devices
            </Link>
          </Button>
        }
      />
    );
  }
  if (query.isError && !device) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} title="Could not load this device" />;
  }
  if (!device) return <DetailSkeleton />;

  const busy = enqueue.isPending;
  const setTab = (next: string) => setParams(new URLSearchParams({ tab: next }), { replace: true });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Devices', to: '/devices' }, { label: device.name }]}
        title={device.name}
        meta={
          <>
            <DeviceStatusPill status={device.status} />
            {!device.isActive && <Badge tone="outline">Inactive</Badge>}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[13px]">{device.serialNumber}</span>
            <span aria-hidden="true">·</span>
            <span>Firmware {device.firmwareVersion ?? 'unknown'}</span>
            <span aria-hidden="true">·</span>
            <span>
              Last seen <RelativeTime iso={device.lastSeenAt} />
            </span>
          </span>
        }
        actions={
          <>
            <Gate perm="devices.manage" action="edit devices">
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            </Gate>
            <Gate perm="devices.command" action="send device commands">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => enqueue.mutate({ device, type: 'info' })}>
                <RefreshCw aria-hidden="true" />
                Refresh info
              </Button>
            </Gate>
            <Gate perm="devices.command" action="send device commands">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => enqueue.mutate({ device, type: 'check' })}>
                <ScanSearch aria-hidden="true" />
                Check for new data
              </Button>
            </Gate>
            <Gate perm="devices.command" action="reboot devices">
              <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: 'reboot', device })}>
                <Power aria-hidden="true" />
                Reboot
              </Button>
            </Gate>
            <Gate perm="devices.manage" action="delete devices">
              <Button variant="destructive-ghost" size="sm" onClick={() => setConfirm({ kind: 'delete', device })}>
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </Gate>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Device sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">
            Users on device
            {device.userCount !== null && (
              <span className="font-figure rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{device.userCount.toLocaleString()}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          {canAudit && <TabsTrigger value="activity">Activity</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <DeviceOverviewTab device={device} />
        </TabsContent>
        <TabsContent value="users">
          <DeviceUsersTab device={device} />
        </TabsContent>
        <TabsContent value="commands">
          <DeviceCommandsTab device={device} />
        </TabsContent>
        {canAudit && (
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>Edits, commands and user changes recorded for this device.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <ActivityFeed filter={{ entityType: 'device', entityId: String(device.id) }} hide="subject" emptyDescription="Edits and commands sent to this device will appear here." />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <DeviceFormSheet open={editOpen} onOpenChange={setEditOpen} device={device} />
      <DeviceConfirmDialogs target={confirm} onClose={() => setConfirm(null)} onDeleted={() => navigate('/devices', { replace: true })} />
    </div>
  );
}

