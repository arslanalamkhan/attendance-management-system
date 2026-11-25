import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Tailwind breakpoints used by the shell. */
export const useIsDesktopXl = () => useMediaQuery('(min-width: 1280px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
