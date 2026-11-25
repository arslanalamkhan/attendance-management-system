import * as React from 'react';
import { Timer } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'] as const;

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Mirrors the server's idle timeout. Real user input keeps the session alive (a quiet /auth/me
 * ping now and then, since the server only sees requests). About two minutes before the limit a dialog
 * counts down; at zero the user is signed out and sent to the login page.
 */
export function IdleTimeout() {
  const { session, refresh, signOut } = useAuth();
  const timeoutMs = (session?.idleTimeoutMinutes ?? 0) * 60_000;
  const expiresAt = session ? new Date(session.expiresAt).getTime() : Infinity;
  const [left, setLeft] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const lastActivity = React.useRef(Date.now());
  const lastPing = React.useRef(Date.now());
  const warningRef = React.useRef(false);

  const stay = React.useCallback(async () => {
    setBusy(true);
    lastActivity.current = Date.now();
    lastPing.current = Date.now();
    warningRef.current = false;
    setLeft(null);
    await refresh();
    setBusy(false);
  }, [refresh]);

  React.useEffect(() => {
    if (!timeoutMs) return;
    const warnMs = Math.min(120_000, timeoutMs / 2);
    let lastMove = 0;

    const onActivity = (e: Event) => {
      // While the countdown is showing, only the explicit button keeps the session.
      if (warningRef.current) return;
      if (e.type === 'pointermove') {
        const now = Date.now();
        if (now - lastMove < 1000) return;
        lastMove = now;
      }
      lastActivity.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });

    const tick = window.setInterval(() => {
      const now = Date.now();
      const remaining = Math.min(lastActivity.current + timeoutMs - now, expiresAt - now);
      if (remaining <= 0) {
        warningRef.current = false;
        setLeft(null);
        void signOut({ expired: true });
        return;
      }
      if (remaining <= warnMs) {
        warningRef.current = true;
        setLeft(remaining);
        return;
      }
      warningRef.current = false;
      setLeft(null);
      // Keep-alive: user is active but may have made no requests recently.
      if (lastActivity.current > lastPing.current && now - lastPing.current > Math.max(30_000, timeoutMs / 3)) {
        lastPing.current = now;
        void refresh();
      }
    }, 1000);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
      window.clearInterval(tick);
    };
  }, [timeoutMs, expiresAt, refresh, signOut]);

  const open = left !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && void stay()}>
      <DialogContent size="sm" hideClose onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center">
          <div className="mb-2 grid size-12 place-content-center rounded-full bg-warning-subtle text-warning-text">
            <Timer className="size-6" aria-hidden="true" />
          </div>
          <DialogTitle className="font-figure text-lg">You&apos;ll be signed out in {clock(left ?? 0)}</DialogTitle>
          <DialogDescription>You have been inactive for a while. To protect the system your session ends automatically.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button variant="secondary" onClick={() => void signOut()} disabled={busy}>
            Sign out
          </Button>
          <Button onClick={() => void stay()} loading={busy} autoFocus>
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
