import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Laptop, LogOut, MapPin, ShieldCheck, Smartphone, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_KEYS } from '@nacta/shared';
import type { SessionSummary } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { listSessions, revokeOtherSessions, revokeSession } from '../../lib/endpoints/auth';
import { qk } from '../../lib/query-keys';
import { parseUserAgent } from '../../lib/user-agent';
import { describeWings } from '../../lib/wing-scope';
import { useWings } from '../../hooks/use-lookups';
import { ChangePasswordForm } from '../../components/auth/change-password-form';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
import { RelativeTime } from '../devices/parts';
import { usePageMeta } from '../../hooks/use-page-meta';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ProfileCard() {
  const { user } = useAuth();
  const wings = useWings();
  if (!user) return null;
  const all = user.wingScope === 'all';
  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={user.name} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{user.name}</h2>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
          {user.isSuperAdmin && (
            <Badge tone="primary" className="ml-auto">
              <ShieldCheck aria-hidden="true" /> Super Admin
            </Badge>
          )}
        </div>
        <dl className="grid gap-5 sm:grid-cols-2">
          <Fact label="Roles">
            <div className="flex flex-wrap gap-1.5">
              {user.roles.length ? user.roles.map((r) => <Badge key={r.id}>{r.name}</Badge>) : <span className="text-muted-foreground">None assigned</span>}
            </div>
          </Fact>
          <Fact label="Access">
            {user.permissions.length} of {PERMISSION_KEYS.length} permissions
            <span className="text-muted-foreground"> · {describeWings(all, all ? [] : (user.wingScope as number[]), wings.data)}</span>
          </Fact>
          <Fact label="Previous sign-in">
            {user.previousLoginAt ? (
              <span>
                <RelativeTime iso={user.previousLoginAt} />
                {user.previousLoginIp && <span className="font-mono text-[13px] text-muted-foreground"> · {user.previousLoginIp}</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">This is your first sign-in</span>
            )}
          </Fact>
        </dl>
      </CardContent>
    </Card>
  );
}

function SessionRow({ s, onRevoke, revoking }: { s: SessionSummary; onRevoke: () => void; revoking: boolean }) {
  const ua = parseUserAgent(s.userAgent);
  const Icon = ua.kind === 'mobile' ? Smartphone : ua.kind === 'desktop' ? Laptop : Globe;
  return (
    <li className="flex items-center gap-4 py-3.5">
      <div className="grid size-10 shrink-0 place-content-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {ua.browser} on {ua.os}
          {s.current && <Badge tone="primary">This device</Badge>}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden="true" />
            <span className="font-mono">{s.ip ?? 'Unknown IP'}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden="true" />
            Active <RelativeTime iso={s.lastSeenAt} />
          </span>
        </p>
      </div>
      {!s.current && (
        <Button variant="secondary" size="sm" onClick={onRevoke} loading={revoking} aria-label={`Sign out ${ua.browser} on ${ua.os}`}>
          Sign out
        </Button>
      )}
    </li>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: qk.auth.sessions(), queryFn: ({ signal }) => listSessions(signal) });
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      toast.success('Session signed out');
      return qc.invalidateQueries({ queryKey: qk.auth.sessions() });
    },
    onError: () => toast.error('Could not sign that session out'),
  });
  const revokeOthers = useApiMutation({
    mutationFn: revokeOtherSessions,
    invalidate: [qk.auth.sessions()],
    successMessage: (r) => (r.revoked ? `Signed out ${r.revoked} other ${r.revoked === 1 ? 'session' : 'sessions'}` : 'No other sessions were active'),
    errorMessage: 'Could not sign out other sessions',
  });
  const sessions = query.data ?? [];
  const others = sessions.filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Everywhere you are currently signed in. Sign out any you do not recognise.</CardDescription>
        </div>
        <Button variant="secondary" size="sm" disabled={others === 0} loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
          {!revokeOthers.isPending && <LogOut aria-hidden="true" />}
          Sign out other sessions
        </Button>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading sessions">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="size-10" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState bare error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : sessions.length === 0 ? (
          <EmptyState bare title="No active sessions" description="Nothing to show right now." />
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <SessionRow key={s.id} s={s} revoking={revoke.isPending && revoke.variables === s.id} onRevoke={() => revoke.mutate(s.id)} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  usePageMeta({ title: 'My account' });
  return (
    <>
      <PageHeader title="My account" description="Your profile, password and the devices you are signed in on." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-6">
          <ProfileCard />
          <SessionsCard />
        </div>
        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Other devices are signed out when you change it.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
