import { FOOTNOTE_ATTRIBUTE, FOOTNOTE_SELECTOR } from './engine/dom';
import { GAP_ATTRIBUTE, SPACE_BEFORE_ATTRIBUTE, cleanEditorArtifacts } from './engine/schema';
import { type SheetFootnote, footnotesHtml } from './footnotes';
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
  /** Receives the footnotes of every sheet whenever they change; the web view is one sheet holding all of them. */
  onFootnotes?: (sheets: SheetFootnote[][]) => void;
  /** Whether an IME composition is in progress, during which blocks must not move. */
  isComposing: () => boolean;
}

/** Rounding tolerance so a block sitting exactly on the page top is never pushed again. */
const EPSILON = 1;
/** Page count reported when pagination is off. */
const SINGLE_PAGE = 1;
/** Measured heights of notes blocks kept before the cache starts over. */
const NOTES_CACHE_LIMIT = 200;

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

/** Where the sheets break and which footnotes each sheet shows. */
interface Layout {
  /** Number of sheets. */
  pageCount: number;
  /** Footnotes of every sheet, in sheet order. */
  footnotes: SheetFootnote[][];
}

/** Texts of the footnote references inside every top-level block, in document order. */
const readBlockFootnotes = (children: HTMLElement[]): string[][] =>
  children.map(child =>
    Array.from(child.querySelectorAll(FOOTNOTE_SELECTOR), reference => reference.getAttribute(FOOTNOTE_ATTRIBUTE) ?? '')
  );

/** Gives every footnote its number, in the order of the blocks. */
const numberFootnotes = (blocks: string[][]): SheetFootnote[][] => {
  let number = 0;
  return blocks.map(texts => texts.map(text => ({ number: ++number, text })));
};

/**
 * Lays top-level blocks out on sheets: a block that would cross the bottom margin, or follows a page break,
 * gets a top margin that moves it to the next sheet. The notes of the footnotes a block refers to go to the bottom
 * of the sheet the block starts on, and the space they need is kept free there. Blocks taller than a page are not
 * split. Layout reads happen before the writes, so a pass costs a single reflow.
 *
 * @param measureNotes Height the notes block of the given footnotes takes on a sheet.
 */
const paginate = (root: HTMLElement, page: PageMetrics, measureNotes: (notes: SheetFootnote[]) => number): Layout => {
  const period = page.height + page.gap;
  const contentStart = (index: number) => Math.round(index * period + page.marginTop);
  const contentEnd = (index: number) => Math.round(index * period + page.height - page.marginBottom);
  const children = Array.from(root.children) as HTMLElement[];
  const blockNotes = numberFootnotes(readBlockFootnotes(children));
  const sheetNotes: SheetFootnote[][] = [];
  /** Bottom of the text area of a sheet once the notes of the sheet, plus `extra`, are drawn under it. */
  const textEnd = (index: number, extra: SheetFootnote[] = []) => {
    const notes = [...(sheetNotes[index] ?? []), ...extra];
    return contentEnd(index) - (notes.length ? measureNotes(notes) : 0);
  };

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
    const notes = blockNotes[index] ?? [];
    if (
      top > contentStart(pageIndex) + EPSILON &&
      (breakBefore || top + height > textEnd(pageIndex, notes) + EPSILON)
    ) {
      pageIndex += 1;
    }
    if (notes.length) sheetNotes[pageIndex] = [...(sheetNotes[pageIndex] ?? []), ...notes];
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
    // A block taller than the text area runs on over the following sheets.
    while (top + height > textEnd(pageIndex) + EPSILON && top + height > contentStart(pageIndex + 1)) pageIndex += 1;
    breakBefore = element.getAttribute('data-type') === 'page-break';
  });

  children.forEach((element, index) => {
    writeGap(element, gaps[index] ?? 0);
  });
  const pageCount = pageIndex + 1;
  return { pageCount, footnotes: Array.from({ length: pageCount }, (_, index) => sheetNotes[index] ?? []) };
};

/**
 * Splits the laid-out document into the clean HTML of every sheet, for printing and export. Pagination has already
 * moved every block onto its page, so a block belongs to the page its top falls on; blocks taller than a page stay
 * whole, exactly as they are shown on screen. Footnote references keep their document-wide numbers.
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
  let firstFootnote = 1;
  return sheets.map(blocks => {
    const container = document.createElement('div');
    container.append(...blocks.map(block => block.cloneNode(true)));
    const references = container.querySelectorAll(FOOTNOTE_SELECTOR).length;
    cleanEditorArtifacts(container, true, firstFootnote);
    firstFootnote += references;
    return container.innerHTML;
  });
};

/** Removes all page gaps, used when switching to the continuous web view, where every footnote is on one sheet. */
const clearGaps = (root: HTMLElement): Layout => {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(`:scope > [${GAP_ATTRIBUTE}]`))) {
    writeGap(element, 0);
  }
  const notes = numberFootnotes(readBlockFootnotes(Array.from(root.children) as HTMLElement[])).flat();
  return { pageCount: SINGLE_PAGE, footnotes: [notes] };
};

/**
 * Keeps the document laid out on sheets. Layout passes are batched to one per animation frame and re-run when the
 * document resizes, images or fonts load, or the host schedules one after an edit.
 */
export const createPagination = (root: HTMLElement, options: PaginationOptions): PaginationController => {
  let metrics: PageMetrics | null = null;
  let frame = 0;
  let pageCount = SINGLE_PAGE;
  /** Footnotes last reported, serialised, so unchanged footnotes are not reported again. */
  let footnotesKey = '';
  /** Hidden notes block the notes of a sheet are measured with. */
  let probe: HTMLElement | null = null;
  const notesHeights = new Map<string, number>();

  /** Height the notes block of the given footnotes takes on a sheet, drawn as wide as the text area. */
  const measureNotes = (notes: SheetFootnote[]) => {
    const width = metrics ? metrics.width - metrics.marginLeft - metrics.marginRight : root.clientWidth;
    const html = footnotesHtml(notes);
    const key = `${width}|${html}`;
    const known = notesHeights.get(key);
    if (known !== undefined) return known;
    if (!probe) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      Object.assign(probe.style, { position: 'absolute', top: '0', left: '0', visibility: 'hidden' });
    }
    if (probe.parentElement !== root.parentElement) root.parentElement?.append(probe);
    probe.style.width = `${width}px`;
    probe.innerHTML = html;
    const height = Math.ceil(probe.offsetHeight);
    if (notesHeights.size > NOTES_CACHE_LIMIT) notesHeights.clear();
    notesHeights.set(key, height);
    return height;
  };

  /** Runs one layout pass and reports a changed page count or changed footnotes. */
  const measure = () => {
    frame = 0;
    // Moving blocks mid-composition disturbs IME and mobile keyboards; the engine re-schedules afterwards.
    if (!root.isConnected || options.isComposing()) return;
    const layout = metrics ? paginate(root, metrics, measureNotes) : clearGaps(root);
    if (layout.pageCount !== pageCount) {
      pageCount = layout.pageCount;
      options.onPageCount(layout.pageCount);
    }
    const key = JSON.stringify(layout.footnotes);
    if (key !== footnotesKey) {
      footnotesKey = key;
      options.onFootnotes?.(layout.footnotes);
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
      probe?.remove();
      observer?.disconnect();
      root.removeEventListener('load', schedule, true);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
};
