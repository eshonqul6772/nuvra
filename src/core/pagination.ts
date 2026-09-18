import { FOOTNOTE_ATTRIBUTE, FOOTNOTE_SELECTOR } from './engine/dom';
import {
  GAP_ATTRIBUTE,
  PAGED_ATTRIBUTE,
  ROTATED_ATTRIBUTE,
  ROW_SHIFT_ATTRIBUTE,
  SPACE_BEFORE_ATTRIBUTE,
  TABLE_SHIFT_ATTRIBUTE,
  cleanEditorArtifacts
} from './engine/schema';
import { type SheetFootnote, footnotesHtml } from './footnotes';
import type { PageMetrics, PageOrientation } from './page';

/** Where a sheet is drawn and which way it is turned. */
export interface SheetGeometry {
  /** Distance of the sheet from the top of the first sheet, in pixels. */
  top: number;
  /** Sheet width in pixels. */
  width: number;
  /** Sheet height in pixels. */
  height: number;
  /** Orientation of the sheet. */
  orientation: PageOrientation;
  /** Whether the sheet is turned against the document's own orientation, by a section break. */
  rotated: boolean;
}

/** Orientation page metrics describe: wider than high is landscape. */
const orientationOf = (metrics: Pick<PageMetrics, 'width' | 'height'>): PageOrientation =>
  metrics.width > metrics.height ? 'landscape' : 'portrait';

/** Whether a block is a section break, which starts a new sheet in its own orientation. */
const isSectionBreak = (element: Element) => element.getAttribute('data-type') === 'section-break';

/** Whether a block starts the next sheet after it: a page break or a section break. */
const breaksPage = (element: Element) => {
  const type = element.getAttribute('data-type');
  return type === 'page-break' || type === 'section-break';
};

/**
 * Orientation of the section every block belongs to: a section break turns the blocks after it; the break itself
 * still belongs to the section it ends.
 */
const blockOrientations = (children: HTMLElement[], base: PageOrientation): PageOrientation[] => {
  let current = base;
  return children.map(child => {
    const orientation = current;
    if (isSectionBreak(child))
      current = child.getAttribute('data-orientation') === 'landscape' ? 'landscape' : 'portrait';
    return orientation;
  });
};

/**
 * Marks the blocks of turned sections, so the editor's styles give them the text width of their sheets before they
 * are measured. Only changed marks touch the DOM, and a document without section breaks has none.
 */
const markRotatedBlocks = (children: HTMLElement[], orientations: PageOrientation[], base: PageOrientation) => {
  children.forEach((child, index) => {
    const rotated = orientations[index] !== base;
    if (rotated !== child.hasAttribute(ROTATED_ATTRIBUTE)) child.toggleAttribute(ROTATED_ATTRIBUTE, rotated);
  });
};

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
  /** Receives the position, size and orientation of every sheet whenever they change; empty in the web view. */
  onSheets?: (sheets: SheetGeometry[]) => void;
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

/** Pixel value pagination stored in an attribute, `0` when absent. */
const readShift = (element: HTMLElement, attribute: string) =>
  Number.parseFloat(element.getAttribute(attribute) ?? '') || 0;

/**
 * Writes a pixel value pagination applies through one style property, together with the attribute that marks it as
 * editor-only; touches the DOM only on change and removes both when the value is `0`.
 */
const writeShift = (
  element: HTMLElement,
  attribute: string,
  property: string,
  value: number,
  format: (pixels: number) => string
) => {
  const rounded = Math.max(0, Math.round(value));
  if (rounded === readShift(element, attribute)) return;
  if (rounded) {
    element.setAttribute(attribute, String(rounded));
    element.style.setProperty(property, format(rounded));
    return;
  }
  element.removeAttribute(attribute);
  element.style.removeProperty(property);
  if (!element.getAttribute('style')) element.removeAttribute('style');
};

/** Moves a table row down by `shift` pixels; a transform leaves the table's own layout, and so its measuring, intact. */
const writeRowShift = (row: HTMLElement, shift: number) =>
  writeShift(row, ROW_SHIFT_ATTRIBUTE, 'transform', shift, pixels => `translateY(${pixels}px)`);

/** Keeps the space the moved rows of a table need below it, so the blocks after the table move with them. */
const writeTableShift = (table: HTMLElement, shift: number) =>
  writeShift(table, TABLE_SHIFT_ATTRIBUTE, 'padding-bottom', shift, pixels => `${pixels}px`);

/** A row of a split table, measured in the table's own coordinates. */
interface MeasuredRow {
  element: HTMLElement;
  top: number;
  height: number;
  /** Whether the table may break before this row: no cell of an earlier row spans down into it. */
  breakable: boolean;
  /** Height of this row and the rows joined to it by spanning cells, which have to stay on one sheet. */
  groupHeight: number;
}

/** Rows of a table's body with where they sit, or `null` for any other block. */
const measureRows = (element: HTMLElement): MeasuredRow[] | null => {
  if (element.tagName !== 'TABLE') return null;
  const rows = Array.from(element.querySelectorAll<HTMLElement>(':scope > tbody > tr'));
  let coveredUntil = -1;
  const measured: MeasuredRow[] = rows.map((row, index) => {
    const breakable = index > coveredUntil;
    for (const cell of Array.from(row.children) as HTMLTableCellElement[]) {
      coveredUntil = Math.max(coveredUntil, index + Math.max(1, cell.rowSpan || 1) - 1);
    }
    const height = row.offsetHeight;
    return { element: row, top: row.offsetTop, height, breakable, groupHeight: height };
  });
  // A group ends where the next row the table may break before starts, or at the bottom of the last row.
  let groupEnd = measured.reduce((bottom, row) => Math.max(bottom, row.top + row.height), 0);
  for (const row of [...measured].reverse()) {
    row.groupHeight = groupEnd - row.top;
    if (row.breakable) groupEnd = row.top;
  }
  return measured;
};

/** Height of a table up to its first row it may break before: the part that has to fit on the sheet it starts on. */
const headHeight = (rows: MeasuredRow[], height: number) => {
  const first = rows[0];
  return first ? first.top + first.groupHeight : height;
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
  /** Position, size and orientation of every sheet; empty when the document is not paginated. */
  sheets: SheetGeometry[];
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
  // Tables of the page view draw their borders so that rows moved to the next sheet take them along.
  if (!root.hasAttribute(PAGED_ATTRIBUTE)) root.setAttribute(PAGED_ATTRIBUTE, '');
  const children = Array.from(root.children) as HTMLElement[];
  const base = orientationOf(page);
  const orientations = blockOrientations(children, base);
  markRotatedBlocks(children, orientations, base);

  // Sheets are added as the blocks reach them; a turned sheet swaps width and height and keeps the margins.
  const sheets: SheetGeometry[] = [];
  const sheetAt = (index: number, orientation: PageOrientation): SheetGeometry => {
    while (sheets.length <= index) {
      const previous = sheets.at(-1);
      const rotated = (sheets.length === index ? orientation : (previous?.orientation ?? base)) !== base;
      sheets.push({
        top: previous ? previous.top + previous.height + page.gap : 0,
        width: rotated ? page.height : page.width,
        height: rotated ? page.width : page.height,
        orientation: rotated ? (base === 'portrait' ? 'landscape' : 'portrait') : base,
        rotated
      });
    }
    return sheets[index] as SheetGeometry;
  };
  let sheetOrientation = orientations[0] ?? base;
  /** Top of the text area of the sheet after `index`, measured without creating that sheet yet. */
  const nextContentStart = (index: number) => {
    const sheet = sheetAt(index, sheetOrientation);
    return Math.round(sheet.top + sheet.height + page.gap + page.marginTop);
  };
  const contentStart = (index: number) => Math.round(sheetAt(index, sheetOrientation).top + page.marginTop);
  const contentEnd = (index: number) => {
    const sheet = sheetAt(index, sheetOrientation);
    return Math.round(sheet.top + sheet.height - page.marginBottom);
  };
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
    // The space a split table keeps for its moved rows is not part of its natural height.
    const tableShift = readShift(element, TABLE_SHIFT_ATTRIBUTE);
    const block = {
      element,
      top: element.offsetTop - appliedShift,
      height: element.offsetHeight - tableShift,
      rows: measureRows(element)
    };
    appliedShift += tableShift;
    return block;
  });

  const gaps: number[] = [];
  /** Shift of every row of every table, in the order of `measured`; empty for other blocks. */
  const rowShifts: number[][] = [];
  let added = 0;
  let pageIndex = 0;
  let breakBefore = false;
  measured.forEach(({ element, top: naturalTop, height, rows }, index) => {
    let top = naturalTop + added;
    const notes = blockNotes[index] ?? [];
    // A sheet takes the orientation of the block that opens it; orientations only change after a section break,
    // which always opens a new sheet.
    sheetOrientation = orientations[index] ?? base;
    // A table only needs its rows up to the first place it may break to fit; the rest can go on the next sheets.
    const fitHeight = rows ? headHeight(rows, height) : height;
    if (
      top > contentStart(pageIndex) + EPSILON &&
      (breakBefore || top + fitHeight > textEnd(pageIndex, notes) + EPSILON)
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
    if (rows) {
      // A row that would cross the bottom of the text area moves, with every row after it, to the top of the next
      // sheet; rows joined by a cell spanning them move together.
      let shift = 0;
      rowShifts[index] = rows.map((row, rowIndex) => {
        let rowTop = top + row.top + shift;
        if (
          rowIndex > 0 &&
          row.breakable &&
          rowTop > contentStart(pageIndex) + EPSILON &&
          rowTop + row.groupHeight > textEnd(pageIndex) + EPSILON
        ) {
          pageIndex += 1;
          const start = contentStart(pageIndex);
          if (rowTop < start) {
            shift += start - rowTop;
            rowTop = start;
          }
        }
        // A row taller than the text area runs on over the following sheets.
        while (rowTop + row.height > textEnd(pageIndex) + EPSILON && rowTop + row.height > nextContentStart(pageIndex))
          pageIndex += 1;
        return shift;
      });
      added += shift;
    } else {
      // A block taller than the text area runs on over the following sheets.
      while (top + height > textEnd(pageIndex) + EPSILON && top + height > nextContentStart(pageIndex)) pageIndex += 1;
    }
    breakBefore = breaksPage(element);
  });

  children.forEach((element, index) => {
    writeGap(element, gaps[index] ?? 0);
    const block = measured[index];
    if (!block?.rows) return;
    const shifts = rowShifts[index] ?? [];
    block.rows.forEach((row, rowIndex) => {
      writeRowShift(row.element, shifts[rowIndex] ?? 0);
    });
    writeTableShift(element, shifts.at(-1) ?? 0);
  });
  const pageCount = pageIndex + 1;
  sheetAt(pageIndex, sheetOrientation);
  return {
    pageCount,
    footnotes: Array.from({ length: pageCount }, (_, index) => sheetNotes[index] ?? []),
    sheets: sheets.slice(0, pageCount)
  };
};

/** Sheets of a document without section breaks, all alike. */
export const uniformSheets = (metrics: PageMetrics, count: number): SheetGeometry[] =>
  Array.from({ length: Math.max(1, count) }, (_, index) => ({
    top: index * (metrics.height + metrics.gap),
    width: metrics.width,
    height: metrics.height,
    orientation: orientationOf(metrics),
    rotated: false
  }));

/** Index of the sheet a vertical position falls on, counted from the top of the first sheet. */
export const sheetIndexAt = (sheets: readonly SheetGeometry[], offset: number): number => {
  let index = 0;
  sheets.forEach((sheet, candidate) => {
    if (sheet.top <= offset + EPSILON) index = candidate;
  });
  return index;
};

/**
 * Splits the laid-out document into the clean HTML of every sheet, for printing and export. Pagination has already
 * moved every block onto its page, so a block belongs to the page its top falls on; blocks taller than a page stay
 * whole, exactly as they are shown on screen. Footnote references keep their document-wide numbers.
 */
export const splitIntoPages = (
  root: HTMLElement,
  metrics: PageMetrics,
  pageCount: number,
  geometry: readonly SheetGeometry[] = uniformSheets(metrics, pageCount)
): string[] => {
  const sheets: Node[][] = Array.from({ length: Math.max(1, pageCount) }, () => []);
  const sheetOf = (offset: number) => Math.min(sheets.length - 1, sheetIndexAt(geometry, offset));
  for (const child of Array.from(root.children) as HTMLElement[]) {
    // Page and section breaks are already expressed by the split itself.
    if (breaksPage(child)) continue;
    if (!child.hasAttribute(TABLE_SHIFT_ATTRIBUTE)) {
      sheets[sheetOf(child.offsetTop)]?.push(child.cloneNode(true));
      continue;
    }
    // A table split over sheets becomes one table per sheet, each with the rows shown on that sheet.
    const parts = new Map<number, HTMLElement>();
    for (const row of Array.from(child.querySelectorAll<HTMLElement>(':scope > tbody > tr'))) {
      const index = sheetOf(child.offsetTop + row.offsetTop + readShift(row, ROW_SHIFT_ATTRIBUTE));
      let part = parts.get(index);
      if (!part) {
        part = child.cloneNode(false) as HTMLElement;
        for (const colgroup of Array.from(child.querySelectorAll(':scope > colgroup'))) {
          part.append(colgroup.cloneNode(true));
        }
        part.append(document.createElement('tbody'));
        parts.set(index, part);
        sheets[index]?.push(part);
      }
      part.querySelector(':scope > tbody')?.append(row.cloneNode(true));
    }
  }
  let firstFootnote = 1;
  return sheets.map(blocks => {
    const container = document.createElement('div');
    container.append(...blocks);
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
  for (const table of Array.from(root.querySelectorAll<HTMLElement>(`:scope > [${TABLE_SHIFT_ATTRIBUTE}]`))) {
    writeTableShift(table, 0);
  }
  for (const row of Array.from(
    root.querySelectorAll<HTMLElement>(`:scope > table > tbody > [${ROW_SHIFT_ATTRIBUTE}]`)
  )) {
    writeRowShift(row, 0);
  }
  if (root.hasAttribute(PAGED_ATTRIBUTE)) root.removeAttribute(PAGED_ATTRIBUTE);
  const notes = numberFootnotes(readBlockFootnotes(Array.from(root.children) as HTMLElement[])).flat();
  return { pageCount: SINGLE_PAGE, footnotes: [notes], sheets: [] };
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
  /** Sheet geometry last reported, serialised. */
  let sheetsKey = '';
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
    const sheets = JSON.stringify(layout.sheets);
    if (sheets !== sheetsKey) {
      sheetsKey = sheets;
      options.onSheets?.(layout.sheets);
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
