import * as React from 'react';

/**
 * Height (px) that lets an element end just above the bottom of the app's scrolling area, leaving `reserve` px for
 * whatever sits under it (pager, legend). Lets a sticky header and a pinned totals row stay on screen.
 * Recomputed on resize and whenever the page content changes height.
 */
export function useFitHeight(ref: React.RefObject<HTMLElement | null>, reserve = 124, min = 320): number | undefined {
  const [height, setHeight] = React.useState<number | undefined>(undefined);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const main = el?.closest('main');
    if (!el || !main) return;
    const compute = () => {
      const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      const next = Math.max(min, Math.floor(main.clientHeight - top - reserve));
      setHeight((h) => (h === next ? h : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(main);
    if (main.firstElementChild) ro.observe(main.firstElementChild);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [ref, reserve, min]);
  return height;
}
