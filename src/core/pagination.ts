import { GAP_ATTRIBUTE } from './engine/schema';
import type { PageMetrics } from './page';

/** Handle returned by {@link createPagination}. */
export interface PaginationController {
  /** Sets the page geometry and re-runs the layout; pass `null` to switch pagination off (web view). */
  setMetrics: (metrics: PageMetrics | null) => void;
  /** Requests a layout pass on the next animation frame, e.g. after the document changed. */
  schedule: () => void;
  /** Stops observing the document and cancels a pending layout pass. */
  destroy: () => void;
}

/** Callbacks the pagination needs from its host. */
interface PaginationOptions {
  /** Receives the number of sheets whenever it changes. */
  onPageCount: (count: number) => void;
  /** Whether an IME composition is in progress, during which blocks must not move. */
  isComposing: () => boolean;
}

/** Rounding tolerance so a block sitting exactly on the page top is never pushed again. */
const EPSILON = 1;
/** Page count reported when pagination is off. */
const SINGLE_PAGE = 1;

/** Top margin that pagination previously applied to a block, in pixels. */
const readGap = (element: HTMLElement) => Number.parseFloat(element.getAttribute(GAP_ATTRIBUTE) ?? '') || 0;

/** Applies or removes the top margin that moves a block to the next sheet, touching the DOM only on change. */
const writeGap = (element: HTMLElement, gap: number) => {
  const rounded = Math.max(0, Math.round(gap));
  if (rounded === readGap(element)) return;
  if (rounded) {
    element.setAttribute(GAP_ATTRIBUTE, String(rounded));
    element.style.marginTop = `${rounded}px`;
    return;
  }
  element.removeAttribute(GAP_ATTRIBUTE);
  element.style.removeProperty('margin-top');
  if (!element.getAttribute('style')) element.removeAttribute('style');
};

/** Computed bottom margin of a block in pixels, `0` when there is no block. */
const marginBottom = (element: HTMLElement | undefined) =>
  element ? Number.parseFloat(getComputedStyle(element).marginBottom) || 0 : 0;

/**
 * Lays top-level blocks out on sheets: a block that would cross the bottom margin, or follows a page break,
 * gets a top margin that moves it to the next sheet. Blocks taller than a page are not split.
 * All layout reads happen before the writes, so a pass costs a single reflow.
 *
 * @returns Number of sheets the document needs.
 */
const paginate = (root: HTMLElement, page: PageMetrics): number => {
  const period = page.height + page.gap;
  const contentStart = (index: number) => Math.round(index * period + page.marginTop);
  const contentEnd = (index: number) => Math.round(index * period + page.height - page.marginBottom);
  const children = Array.from(root.children) as HTMLElement[];

  let appliedShift = 0;
  const measured = children.map((element, index) => {
    const gap = readGap(element);
    if (gap) {
      // A top margin collapses with the previous block's bottom margin; only the excess moved the block.
      const previousMargin = index > 0 ? marginBottom(children[index - 1]) : 0;
      appliedShift += index > 0 ? Math.max(gap, previousMargin) - previousMargin : gap;
    }
    return { element, top: element.offsetTop - appliedShift, height: element.offsetHeight };
  });

  const gaps: number[] = [];
  let added = 0;
  let pageIndex = 0;
  let breakBefore = false;
  measured.forEach(({ element, top: naturalTop, height }, index) => {
    let top = naturalTop + added;
    if (top > contentStart(pageIndex) + EPSILON && (breakBefore || top + height > contentEnd(pageIndex) + EPSILON)) {
      pageIndex += 1;
    }
    const start = contentStart(pageIndex);
    let gap = 0;
    if (top < start - EPSILON) {
      const shift = start - top;
      gap = index > 0 ? shift + marginBottom(children[index - 1]) : shift;
      added += shift;
      top = start;
    }
    gaps.push(gap);
    while (top + height > contentEnd(pageIndex) + EPSILON) pageIndex += 1;
    breakBefore = element.getAttribute('data-type') === 'page-break';
  });

  children.forEach((element, index) => {
    writeGap(element, gaps[index] ?? 0);
  });
  return pageIndex + 1;
};

/** Removes all page gaps, used when switching to the continuous web view. */
const clearGaps = (root: HTMLElement) => {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(`:scope > [${GAP_ATTRIBUTE}]`))) {
    writeGap(element, 0);
  }
  return SINGLE_PAGE;
};

/**
 * Keeps the document laid out on sheets. Layout passes are batched to one per animation frame and re-run when the
 * document resizes, images or fonts load, or the host schedules one after an edit.
 */
export const createPagination = (root: HTMLElement, options: PaginationOptions): PaginationController => {
  let metrics: PageMetrics | null = null;
  let frame = 0;
  let pageCount = SINGLE_PAGE;

  /** Runs one layout pass and reports a changed page count. */
  const measure = () => {
    frame = 0;
    // Moving blocks mid-composition disturbs IME and mobile keyboards; the engine re-schedules afterwards.
    if (!root.isConnected || options.isComposing()) return;
    const count = metrics ? paginate(root, metrics) : clearGaps(root);
    if (count !== pageCount) {
      pageCount = count;
      options.onPageCount(count);
    }
  };

  /** Requests a layout pass unless one is already waiting for the next frame. */
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(root);
  // Images and web fonts change block heights without any edit.
  root.addEventListener('load', schedule, true);
  void document.fonts?.ready.then(schedule);

  return {
    setMetrics: next => {
      metrics = next;
      schedule();
    },
    schedule,
    destroy: () => {
      observer?.disconnect();
      root.removeEventListener('load', schedule, true);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
};
