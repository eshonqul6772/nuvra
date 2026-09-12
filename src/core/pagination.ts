import { GAP_ATTRIBUTE, SPACE_BEFORE_ATTRIBUTE, cleanEditorArtifacts } from './engine/schema';
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

/** CSS pixels per point, used for the spacing a paragraph sets itself. */
const PX_PER_POINT = 4 / 3;

/** Top margin that pagination previously applied to a block, in pixels. */
const readGap = (element: HTMLElement) => Number.parseFloat(element.getAttribute(GAP_ATTRIBUTE) ?? '') || 0;

/** Space the paragraph itself keeps before it, in pixels; pagination adds its gap on top of it. */
const ownSpace = (element: HTMLElement | undefined) =>
  element ? (Number.parseFloat(element.getAttribute(SPACE_BEFORE_ATTRIBUTE) ?? '') || 0) * PX_PER_POINT : 0;

/** Applies or removes the top margin that moves a block to the next sheet, touching the DOM only on change. */
const writeGap = (element: HTMLElement, gap: number) => {
  const rounded = Math.max(0, Math.round(gap));
  if (rounded === readGap(element)) return;
  const own = element.getAttribute(SPACE_BEFORE_ATTRIBUTE);
  if (rounded) {
    element.setAttribute(GAP_ATTRIBUTE, String(rounded));
    element.style.marginTop = `${Math.round(rounded + ownSpace(element))}px`;
    return;
  }
  element.removeAttribute(GAP_ATTRIBUTE);
  if (own) element.style.marginTop = `${own}pt`;
  else element.style.removeProperty('margin-top');
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
      // A top margin collapses with the previous block's bottom margin, and with the paragraph's own space before
      // it; only what the gap added on top of that collapsed margin actually moved the block.
      const previousMargin = index > 0 ? marginBottom(children[index - 1]) : 0;
      const own = ownSpace(element);
      appliedShift += Math.max(gap + own, previousMargin) - Math.max(own, previousMargin);
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
      // The gap has to lift the block by `shift` over the margin it collapses into today.
      const own = ownSpace(element);
      const collapsed = index > 0 ? Math.max(own, marginBottom(children[index - 1])) : own;
      gap = collapsed + shift - own;
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

/**
 * Splits the laid-out document into the clean HTML of every sheet, for printing and export. Pagination has already
 * moved every block onto its page, so a block belongs to the page its top falls on; blocks taller than a page stay
 * whole, exactly as they are shown on screen.
 */
export const splitIntoPages = (root: HTMLElement, metrics: PageMetrics, pageCount: number): string[] => {
  const period = metrics.height + metrics.gap;
  const sheets: HTMLElement[][] = Array.from({ length: Math.max(1, pageCount) }, () => []);
  for (const child of Array.from(root.children) as HTMLElement[]) {
    // Manual page breaks are already expressed by the split itself.
    if (child.getAttribute('data-type') === 'page-break') continue;
    const index = Math.min(sheets.length - 1, Math.max(0, Math.floor((child.offsetTop + EPSILON) / period)));
    sheets[index]?.push(child);
  }
  return sheets.map(blocks => {
    const container = document.createElement('div');
    container.append(...blocks.map(block => block.cloneNode(true)));
    cleanEditorArtifacts(container, true);
    return container.innerHTML;
  });
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
