import { useMediaQuery } from './use-media-query';

/** True when the user asked the OS for less motion. */
export const useReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)');
