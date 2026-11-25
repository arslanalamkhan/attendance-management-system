import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CurrentUser, LoginInput, Permission, SessionInfo, WingScope } from '@nacta/shared';
import { isApiError } from './api';
import { getMe, getMeQuietly, login, logout } from './endpoints/auth';
import { sessionBridge } from './session-bridge';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';
/** Why the user is looking at the sign-in page without having clicked "Sign out". */
export type AuthNotice = 'expired' | 'signed-out' | null;

export interface AuthContextValue {
  status: AuthStatus;
  /** Why /auth/me could not be loaded (status "error"). */
  error: unknown;
  session: SessionInfo | null;
  user: CurrentUser | null;
  notice: AuthNotice;
  can: (permission: Permission) => boolean;
  /** True when the user has at least one of the permissions. */
  canAny: (...permissions: Permission[]) => boolean;
  wingScope: WingScope;
  signIn: (input: LoginInput) => Promise<SessionInfo>;
  /** Ends the session on the server (best effort) and clears local state. */
  signOut: (opts?: { expired?: boolean }) => Promise<void>;
  /** Re-reads /auth/me (also refreshes the idle timer on the server). Returns null if the session is gone. */
  refresh: () => Promise<SessionInfo | null>;
  /** Adopts a SessionInfo returned by another endpoint (change-password). */
  applySession: (info: SessionInfo) => void;
  clearNotice: () => void;
  /** Re-run the initial /auth/me load after a network failure. */
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notice, setNotice] = useState<AuthNotice>(null);
  const userIdRef = useRef<number | null>(null);
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = status;

  const applySession = useCallback(
    (info: SessionInfo) => {
      // A different person (or first sign-in after sign-out) must never see the previous user's cached data.
      if (userIdRef.current !== info.user.id) qc.clear();
      userIdRef.current = info.user.id;
      sessionBridge.setCsrfToken(info.csrfToken);
      setSession(info);
      setError(null);
      setStatus('authenticated');
    },
    [qc],
  );

  const clearSession = useCallback(
    (nextNotice: AuthNotice) => {
      userIdRef.current = null;
      sessionBridge.setCsrfToken(null);
      qc.clear();
      setSession(null);
      setNotice(nextNotice);
      setStatus('anonymous');
    },
    [qc],
  );

  // Initial load of the session.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    getMe(ac.signal)
      .then(applySession)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (isApiError(e) && e.status === 401) clearSession(null);
        else {
          setError(e);
          setStatus('error');
        }
      });
    return () => ac.abort();
  }, [attempt, applySession, clearSession]);

  // Any 401 from the API client ends the session; PASSWORD_CHANGE_REQUIRED forces the change screen.
  useEffect(() => {
    sessionBridge.setHandlers({
      unauthenticated: () => {
        if (statusRef.current === 'authenticated') clearSession('expired');
      },
      passwordChangeRequired: () =>
        setSession((s) => (s && !s.user.mustChangePassword ? { ...s, user: { ...s.user, mustChangePassword: true } } : s)),
    });
    return () => sessionBridge.setHandlers({ unauthenticated: null, passwordChangeRequired: null });
  }, [clearSession]);

  const signIn = useCallback(
    async (input: LoginInput) => {
      const info = await login(input);
      setNotice(null);
      applySession(info);
      return info;
    },
    [applySession],
  );

  const signOut = useCallback(
    async (opts?: { expired?: boolean }) => {
      try {
        await logout();
      } catch {
        /* the cookie may already be invalid: local sign-out proceeds regardless */
      }
      clearSession(opts?.expired ? 'expired' : 'signed-out');
    },
    [clearSession],
  );

  const refresh = useCallback(async () => {
    try {
      const info = await getMe();
      applySession(info);
      return info;
    } catch (e) {
      if (isApiError(e) && e.status === 401) clearSession('expired');
      return null;
    }
  }, [applySession, clearSession]);

  // Automatic permission refresh: re-read /auth/me when the tab regains focus and every 5 minutes while visible,
  // so a role change or a deploy that adds permissions shows up without signing out. Changes apply silently;
  // route guards re-evaluate on their own (a page the user lost shows the 403 page).
  const lastCheck = useRef(Date.now());
  const quietRefresh = useCallback(async () => {
    if (statusRef.current !== 'authenticated') return;
    lastCheck.current = Date.now();
    try {
      const info = await getMeQuietly();
      setSession((prev) => {
        if (!prev || prev.user.id !== info.user.id) return prev;
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        const u = prev.user;
        const unchanged =
          same(u.permissions, info.user.permissions) &&
          same(u.wingScope, info.user.wingScope) &&
          same(u.roles, info.user.roles) &&
          u.mustChangePassword === info.user.mustChangePassword &&
          u.name === info.user.name &&
          u.isSuperAdmin === info.user.isSuperAdmin;
        sessionBridge.setCsrfToken(info.csrfToken);
        // Keep the same user object when nothing changed so `can` stays referentially stable (no re-render storm).
        return { ...info, user: unchanged ? prev.user : info.user };
      });
    } catch (e) {
      if (isApiError(e) && e.status === 401) clearSession('expired');
      /* other failures (offline, 5xx) are ignored: the next check will retry */
    }
  }, [clearSession]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const check = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 15_000) void quietRefresh();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void quietRefresh();
    }, 5 * 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [status, quietRefresh]);

  const user = session?.user ?? null;
  const permissionSet = useMemo(() => new Set<string>(user?.permissions ?? []), [user]);
  const can = useCallback((p: Permission) => permissionSet.has(p), [permissionSet]);
  const canAny = useCallback((...ps: Permission[]) => ps.some((p) => permissionSet.has(p)), [permissionSet]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      error,
      session,
      user,
      notice,
      can,
      canAny,
      wingScope: user?.wingScope ?? [],
      signIn,
      signOut,
      refresh,
      applySession,
      clearNotice: () => setNotice(null),
      retry: () => setAttempt((n) => n + 1),
    }),
    [status, error, session, user, notice, can, canAny, signIn, signOut, refresh, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** For components that only render once the user is signed in. */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser called without a signed-in user');
  return user;
}

