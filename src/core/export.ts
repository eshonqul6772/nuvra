import contentCss from '../styles/document-content.css?inline';
import { type SheetFootnote, footnotesHtml } from './footnotes';
import {
  type HeaderFooterContext,
  PAGE_SIZES,
  type PageHeaderFooter,
  type PageSettings,
  type PageWatermark,
  WATERMARK_ANGLE,
  hasHeaderFooterText,
  hasWatermarkText,
  pageNumberOf,
  renderHeaderFooter,
  showsRunningTexts,
  watermarkFontSize
} from './page';

/** Everything needed to print or export the document. */
interface DocumentSnapshot {
  /** Clean document HTML, used when the document is not laid out in sheets. */
  html: string;
  /**
   * Clean HTML of every sheet, in document order. The page view passes it so printing repeats the header and footer
   * with real page numbers and breaks the pages exactly where the editor shows them.
   */
  pages?: string[];
  /** For every sheet of `pages`, whether a section break turned it against the document's orientation. */
  rotated?: boolean[];
  /** Footnotes of every sheet of `pages`; without pages, the notes of all of them are printed after the document. */
  footnotes?: SheetFootnote[][];
  /** Document title, used for the print title and file names. */
  title: string;
  /** Page size, orientation, margins and the running texts. */
  page: PageSettings;
}

/** Characters escaped when text is placed into HTML. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Characters not allowed in file names on common systems. */
const INVALID_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]+/g;
/** File name used when the title is empty. */
const DEFAULT_FILE_NAME = 'document';
/** Removes the print iframe even when the browser never reports `afterprint`. */
const PRINT_CLEANUP_TIMEOUT_MS = 60_000;
/** Distance a running text keeps from the paper edge when its margin is too small to centre it in, in millimetres. */
const MIN_RUNNING_EDGE_MM = 4;
/** CSS pixels per millimetre at 96 DPI, used to size the watermark for the paper. */
const PX_PER_MM = 96 / 25.4;
/** How faintly the watermark is printed. */
const WATERMARK_OPACITY = 0.16;
/** The three parts of a running text, in the order they are drawn. */
const RUNNING_PARTS = ['left', 'center', 'right'] as const;
/** Styles that keep the print iframe out of view without `display: none`, which would stop it from printing. */
const HIDDEN_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '-10000px',
  top: '0',
  width: '1px',
  height: '1px',
  border: '0'
};

/** Escapes text for use inside HTML. */
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => HTML_ESCAPES[character] ?? character);

/** Paper width and height in millimetres, in the chosen orientation. */
export const paperSize = ({ size, orientation }: PageSettings) => {
  const paper = PAGE_SIZES[size] ?? PAGE_SIZES.a4;
  const portrait = orientation === 'portrait';
  return { width: portrait ? paper.width : paper.height, height: portrait ? paper.height : paper.width };
};

/** CSS declarations for `@page` with the paper size and margins of the page settings. */
const pageRule = (page: PageSettings) => {
  const { width, height } = paperSize(page);
  const { margins } = page;
  return `size: ${width}mm ${height}mm; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;`;
};

/** Distance of a running text from the top or bottom edge of the paper, centred in its margin. */
const runningEdge = (margin: number) => Math.max(MIN_RUNNING_EDGE_MM, margin / 2 - 2);

/** Shared look of the header and footer, both in print and in the exported page. */
const RUNNING_CSS = `
.doc-running { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; color: #475467; font: 10pt/1.4 'Times New Roman', Times, serif; }
.doc-running span { min-width: 0; overflow: hidden; white-space: pre-wrap; }
.doc-running span:nth-child(2) { text-align: center; }
.doc-running span:nth-child(3) { text-align: right; }`;

/** One running text rendered for a page, or an empty string when it holds no text. */
const runningHtml = (
  value: PageHeaderFooter | undefined,
  place: 'header' | 'footer',
  context: HeaderFooterContext
): string => {
  if (!value || !hasHeaderFooterText(value)) return '';
  const parts = RUNNING_PARTS.map(part => `<span>${escapeHtml(renderHeaderFooter(value[part], context))}</span>`).join(
    ''
  );
  return `<div class="doc-running doc-running--${place}">${parts}</div>`;
};

/** The watermark of a page, or an empty string when the document has none. */
const watermarkHtml = (watermark: PageWatermark | undefined): string =>
  hasWatermarkText(watermark) && watermark
    ? `<div class="doc-watermark">${escapeHtml(watermark.text.trim())}</div>`
    : '';

/** Look of the watermark; it is positioned per sheet when the pages are known, and fixed when the document flows. */
const watermarkCss = (page: PageSettings, fixed: boolean): string => {
  const { watermark } = page;
  if (!hasWatermarkText(watermark) || !watermark) return '';
  const { width, height } = paperSize(page);
  const size = watermarkFontSize(width * PX_PER_MM, height * PX_PER_MM, watermark.text, watermark.diagonal);
  const rotation = watermark.diagonal ? ` transform: rotate(${WATERMARK_ANGLE}deg);` : '';
  return `
.doc-watermark { position: ${fixed ? 'fixed' : 'absolute'}; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; color: ${watermark.color}; font: 700 ${size}px/1 'Times New Roman', Times, serif; letter-spacing: 0.06em; opacity: ${WATERMARK_OPACITY}; text-transform: uppercase; white-space: nowrap; pointer-events: none;${rotation} }`;
};

/** Sheets with their own header and footer, used when the editor knows where the pages break. */
const sheetsHtml = (
  pages: string[],
  page: PageSettings,
  title: string,
  footnotes: SheetFootnote[][] = [],
  rotated: boolean[] = []
): string =>
  pages
    .map((content, index) => {
      const context: HeaderFooterContext = { page: pageNumberOf(page, index + 1), pages: pages.length, title };
      const shown = showsRunningTexts(page, index + 1);
      const header = shown ? runningHtml(page.header, 'header', context) : '';
      const footer = shown ? runningHtml(page.footer, 'footer', context) : '';
      const watermark = watermarkHtml(page.watermark);
      const notes = footnotes[index]?.length
        ? `<div class="doc-sheet__notes">${footnotesHtml(footnotes[index] ?? [])}</div>`
        : '';
      const className = rotated[index] ? 'doc-sheet is-rotated' : 'doc-sheet';
      return `<section class="${className}">${watermark}${header}<article class="doc-content">${content}</article>${notes}${footer}</section>`;
    })
    .join('');

/** Page geometry of the sheet layout: the paper is the page box and every sheet carries the margins itself. */
const sheetCss = (page: PageSettings) => {
  const { width, height } = paperSize(page);
  const { margins } = page;
  return `@page { size: ${width}mm ${height}mm; margin: 0; }
.doc-sheet { position: relative; box-sizing: border-box; width: ${width}mm; min-height: ${height}mm; padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm; overflow: hidden; background: #fff; break-after: page; }
.doc-sheet:last-child { break-after: auto; }
@page rotated { size: ${height}mm ${width}mm; margin: 0; }
.doc-sheet.is-rotated { width: ${height}mm; min-height: ${width}mm; page: rotated; }
.doc-running { position: absolute; right: ${margins.right}mm; left: ${margins.left}mm; }
.doc-sheet__notes { position: absolute; right: ${margins.right}mm; bottom: ${margins.bottom}mm; left: ${margins.left}mm; }
.doc-running--header { top: ${runningEdge(margins.top)}mm; }
.doc-running--footer { bottom: ${runningEdge(margins.bottom)}mm; }${RUNNING_CSS}${watermarkCss(page, false)}`;
};

/** Page geometry of the flowing layout, where the browser breaks the pages and repeats the fixed running texts. */
const flowCss = (page: PageSettings) => {
  const { margins } = page;
  return `@page { ${pageRule(page)} }
.doc-running { position: fixed; right: 0; left: 0; }
.doc-running--header { top: -${runningEdge(margins.top)}mm; }
.doc-running--footer { bottom: -${runningEdge(margins.bottom)}mm; }${RUNNING_CSS}${watermarkCss(page, true)}`;
};

/** Turns a document title into a safe file name without extension. */
export const toFileName = (title: string): string =>
  title.replace(INVALID_FILE_NAME_CHARACTERS, ' ').trim() || DEFAULT_FILE_NAME;

/**
 * Standalone HTML with the page size, margins and running texts encoded in CSS, used for printing and HTML export.
 * With the sheets of the page view every page carries its own header and footer, so the page numbers are exact and
 * the pages break where the editor shows them; without them the document flows and the browser repeats one fixed
 * header and footer on every page.
 */
export const buildPrintableHtml = ({ html, pages, rotated, footnotes, title, page }: DocumentSnapshot): string => {
  const paginated = pages !== undefined && pages.length > 0;
  const context: HeaderFooterContext = { page: 1, pages: 1, title };
  const flow = `${watermarkHtml(page.watermark)}${runningHtml(page.header, 'header', context)}${runningHtml(page.footer, 'footer', context)}<article class="doc-content">${html}</article>${footnotesHtml(footnotes?.flat() ?? [])}`;
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${paginated ? sheetCss(page) : flowCss(page)} html, body { margin: 0; background: #fff; } ${contentCss}</style>
</head>
<body>${paginated && pages ? sheetsHtml(pages, page, title, footnotes, rotated) : flow}</body>
</html>`;
};

/** Offers text or binary content as a file download. */
export const downloadFile = (content: string | Blob, fileName: string, type: string): void => {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Prints through a detached iframe so the application chrome never ends up on paper. Waits for images first. */
export const printHtml = (documentHtml: string): void => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, HIDDEN_FRAME_STYLE);

  /** Removes the iframe once printing is done. */
  const cleanup = () => frame.remove();
  frame.onload = () => {
    const printWindow = frame.contentWindow;
    if (!printWindow) return cleanup();
    const pendingImages = Array.from(printWindow.document.images)
      .filter(image => !image.complete)
      .map(
        image =>
          new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          })
      );
    void Promise.allSettled(pendingImages).then(() => {
      printWindow.addEventListener('afterprint', () => setTimeout(cleanup, 0), { once: true });
      printWindow.focus();
      printWindow.print();
      setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS);
    });
  };
  frame.srcdoc = documentHtml;
  document.body.appendChild(frame);
};
