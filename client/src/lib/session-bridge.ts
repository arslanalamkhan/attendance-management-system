/**
 * Tiny module-level bridge between the API client (plain TS, no React) and the AuthProvider.
 * The provider publishes the CSRF token and registers handlers; `request()` reads/calls them.
 */
let csrfToken: string | null = null;

type Handler = () => void;
let onUnauthenticated: Handler | null = null;
let onPasswordChangeRequired: Handler | null = null;

export const sessionBridge = {
  getCsrfToken: () => csrfToken,
  setCsrfToken: (token: string | null) => {
    csrfToken = token;
  },
  setHandlers: (h: { unauthenticated: Handler | null; passwordChangeRequired: Handler | null }) => {
    onUnauthenticated = h.unauthenticated;
    onPasswordChangeRequired = h.passwordChangeRequired;
  },
  notifyUnauthenticated: () => onUnauthenticated?.(),
  notifyPasswordChangeRequired: () => onPasswordChangeRequired?.(),
};
