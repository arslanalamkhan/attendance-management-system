import type { ReactNode } from 'react';
import type { Permission } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import ForbiddenPage from '../../pages/auth/ForbiddenPage';

/** Route guard: renders the page when the user holds ANY of the permissions, otherwise the 403 page. */
export function RequirePermission({ any, children }: { any: Permission[]; children: ReactNode }) {
  const { canAny } = useAuth();
  return canAny(...any) ? <>{children}</> : <ForbiddenPage required={any} />;
}
