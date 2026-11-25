import type { Permission, WingScope } from '@nacta/shared';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  mustChangePassword: boolean;
  isSuperAdmin: boolean;
  roles: { id: number; name: string }[];
  previousLoginAt: Date | null;
  previousLoginIp: string | null;
}

/** Everything the request pipeline knows about the signed-in caller. Set on `req.auth`. */
export interface AuthContext {
  user: AuthUser;
  session: { id: string; csrfToken: string; expiresAt: Date };
  /** Effective permissions: the union over all roles (every key for Super Admin). */
  permissions: ReadonlySet<Permission>;
  scope: WingScope;
}
