import { useSyncExternalStore } from 'react';
import { API_BASE, endpoints } from '@nacta/shared';

type Resolver = (employeeId: number) => string | null;

let resolver: Resolver | null = null;
const versions = new Map<number, number>();

/**
 * Dev mock only: `<img>` requests bypass window.fetch, so the mock installs a resolver that
 * returns generated image data instead of the API path. Never set in production builds.
 */
export function setPhotoSrcResolver(fn: Resolver | null): void {
  resolver = fn;
}

/** Call after a photo is uploaded or removed so avatars bypass the 5-minute browser cache. */
export function bumpPhotoVersion(employeeId: number): void {
  versions.set(employeeId, Date.now());
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** Re-renders the caller when any photo changes; returns a token that changes with it. */
export function usePhotoVersion(employeeId: number | null): number {
  return useSyncExternalStore(subscribe, () => (employeeId === null ? 0 : (versions.get(employeeId) ?? 0)));
}

/** Same-origin photo URL (session cookie travels with it). `version` busts caches. */
export function photoSrc(employeeId: number, version?: string | number | null): string {
  const mocked = resolver?.(employeeId);
  if (mocked) return mocked;
  const v = version ?? versions.get(employeeId);
  return `${API_BASE}${endpoints.employeePhoto(employeeId)}${v ? `?v=${encodeURIComponent(String(v))}` : ''}`;
}

