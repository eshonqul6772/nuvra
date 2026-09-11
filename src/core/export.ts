import contentCss from '../styles/document-content.css?inline';
import { PAGE_SIZES, type PageSettings } from './page';

/** Everything needed to print or export the document. */
interface DocumentSnapshot {
  /** Clean document HTML. */
  html: string;
  /** Document title, used for the print title and file names. */
  title: string;
  /** Page size, orientation and margins. */
  page: PageSettings;
}

/** Makes Word detect UTF-8 instead of the system code page. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfe_ff);
/** Characters escaped when text is placed into HTML. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Page break markup of the editor. */
const PAGE_BREAK_PATTERN = /<div[^>]*data-type="page-break"[^>]*><\/div>/g;
/** Page break markup Word understands. */
const WORD_PAGE_BREAK = '<br clear="all" style="page-break-before: always">';
/** Characters not allowed in file names on common systems. */
const INVALID_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]+/g;
/** File name used when the title is empty. */
const DEFAULT_FILE_NAME = 'document';
/** Removes the print iframe even when the browser never reports `afterprint`. */
const PRINT_CLEANUP_TIMEOUT_MS = 60_000;
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

/** CSS declarations for `@page` with the paper size and margins of the page settings. */
const pageRule = ({ size, orientation, margins }: PageSettings) => {
  const paper = PAGE_SIZES[size] ?? PAGE_SIZES.a4;
  const [width, height] = orientation === 'portrait' ? [paper.width, paper.height] : [paper.height, paper.width];
  return `size: ${width}mm ${height}mm; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;`;
};

/** Turns a document title into a safe file name without extension. */
export const toFileName = (title: string): string =>
  title.replace(INVALID_FILE_NAME_CHARACTERS, ' ').trim() || DEFAULT_FILE_NAME;

/** Standalone HTML with the page size and margins encoded as `@page`, used for printing and HTML export. */
export const buildPrintableHtml = ({ html, title, page }: DocumentSnapshot): string =>
  `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>@page { ${pageRule(page)} } html, body { margin: 0; background: #fff; } ${contentCss}</style>
</head>
<body><article class="doc-content">${html}</article></body>
</html>`;

/** Word opens HTML saved with the Office namespaces as a regular document in print layout. */
export const buildWordHtml = ({ html, title, page }: DocumentSnapshot): string => {
  const body = html.replace(PAGE_BREAK_PATTERN, WORD_PAGE_BREAK);
  return `${BYTE_ORDER_MARK}<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page Section1 { ${pageRule(page)} } div.Section1 { page: Section1; } ${contentCss}</style>
</head>
<body><div class="Section1 doc-content">${body}</div></body>
</html>`;
};

/** Offers text content as a file download. */
export const downloadFile = (content: string, fileName: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }));
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
