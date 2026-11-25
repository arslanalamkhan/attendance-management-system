import { useSyncExternalStore } from 'react';

/**
 * One shared 1-second ticker for every relative timestamp on screen. The interval only runs
 * while at least one component is subscribed, so idle pages cost nothing.
 */
let current = Date.now();
let timer: number | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = window.setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => current;

/** Current time in ms, re-rendering the caller once per second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
