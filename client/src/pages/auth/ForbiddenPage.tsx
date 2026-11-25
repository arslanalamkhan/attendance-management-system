import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldOff } from 'lucide-react';
import { PERMISSIONS } from '@nacta/shared';
import type { Permission } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import { firstAccessiblePath } from '../../lib/nav';
import { Button } from '../../components/ui/button';

export default function ForbiddenPage({ required = [] }: { required?: Permission[] }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const home = firstAccessiblePath(can);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <div className="relative mb-6 grid size-16 place-content-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
        <ShieldOff className="size-7" aria-hidden="true" />
        <span className="absolute -right-2 -top-2 rounded-full border bg-danger-subtle px-1.5 py-0.5 text-[10px] font-semibold text-danger-text">403</span>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your role does not include the permission needed to open it. If you think you should have access, ask a Super Admin to update your role.
      </p>
      {required.length > 0 && (
        <div className="mt-5 w-full rounded-lg border bg-card p-4 text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permission needed</p>
          <ul className="mt-2 space-y-1.5">
            {required.map((p) => (
              <li key={p} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="font-medium">{PERMISSIONS[p].label}</span>
                <code className="font-mono text-xs text-muted-foreground">{p}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          <ArrowLeft aria-hidden="true" />
          Go back
        </Button>
        <Button asChild>
          <Link to={home ?? '/account'}>{home ? 'Go to my home page' : 'Open my account'}</Link>
        </Button>
      </div>
    </div>
  );
}
