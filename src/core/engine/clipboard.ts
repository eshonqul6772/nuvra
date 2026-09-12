/** Reading and writing clipboard and drag-and-drop data in the formats the editor understands. */
import { createParagraph, textBlocksInRange } from './dom';
import { cleanEditorArtifacts, sanitizeHtml } from './schema';

/** The parts of a clipboard or drag payload the editor uses. */
export interface TransferContent {
  /** Rich HTML, empty when the source offered none. */
  html: string;
  /** Plain text, empty when the source offered none. */
  text: string;
  /** Files, e.g. pasted screenshots or dropped images. */
  files: File[];
}

/** MIME types the editor accepts as images. */
const IMAGE_MIME = /^image\//;

/** A payload consisting of exactly one web address. */
const SINGLE_URL = /^(?:https?:\/\/|www\.)\S+$/i;

/** Extracts HTML, text and files from a clipboard or drag payload. */
export const readTransfer = (data: DataTransfer | null): TransferContent => ({
  html: data?.getData('text/html') ?? '',
  text: data?.getData('text/plain') ?? '',
  files: Array.from(data?.files ?? [])
});

/** The image files of a payload. */
export const imageFiles = (content: TransferContent): File[] =>
  content.files.filter(file => IMAGE_MIME.test(file.type));

/** The URL when the plain text is a single web address (`www.` addresses get `https://`), otherwise `null`. */
export const singleUrl = (content: TransferContent): string | null => {
  const text = content.text.trim();
  if (!SINGLE_URL.test(text)) return null;
  return text.startsWith('www.') ? `https://${text}` : text;
};

/** Converts plain text into paragraphs, one per line; a final line break does not add an empty paragraph. */
export const textToFragment = (text: string): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  for (const line of lines) fragment.append(createParagraph(line ? [document.createTextNode(line)] : []));
  return fragment;
};

/** Converts a payload into editor blocks, preferring sanitised HTML over plain text; `null` when it has neither. */
export const transferToFragment = (content: TransferContent): DocumentFragment | null => {
  if (content.html) return sanitizeHtml(content.html);
  return content.text ? textToFragment(content.text) : null;
};

/** Plain text of a range with a line break between blocks, which `Range.toString()` loses. */
const rangeText = (root: HTMLElement, range: Range): string => {
  const blocks = textBlocksInRange(root, range);
  if (blocks.length < 2) return range.toString();
  return blocks
    .map(block => {
      const part = document.createRange();
      part.selectNodeContents(block);
      if (block.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (block.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      return part.toString();
    })
    .join('\n');
};

/** Clean HTML and plain text of a selection, as put on the clipboard by copy, cut and drag. */
export const selectionClipboardData = (root: HTMLElement, range: Range): { html: string; text: string } => {
  const container = document.createElement('div');
  container.append(range.cloneContents());
  cleanEditorArtifacts(container, true);
  return { html: container.innerHTML, text: rangeText(root, range) };
};

/** Puts clean HTML and plain text of the selection on a clipboard or drag payload for copy, cut and drag. */
export const writeTransfer = (data: DataTransfer, root: HTMLElement, range: Range): void => {
  const { html, text } = selectionClipboardData(root, range);
  data.setData('text/html', html);
  data.setData('text/plain', text);
};

/** `Document` with both caret-from-point APIs, which not every browser (or TypeScript lib) provides. */
type CaretDocument = Document & {
  /** Standard API (Firefox, recent Chromium). */
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  /** Legacy WebKit/Chromium API. */
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** Collapsed range at the text position under the pointer, used to place dropped content and canvas clicks. */
export const rangeFromPoint = (x: number, y: number): Range | null => {
  const doc = document as CaretDocument;
  if (!doc.caretPositionFromPoint) return doc.caretRangeFromPoint?.(x, y) ?? null;
  const position = doc.caretPositionFromPoint(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
};
