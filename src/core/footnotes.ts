/**
 * The notes of footnotes as they are drawn at the bottom of a sheet. The editor, the layout measurement and printing
 * all render them with this markup, so the space pagination reserves matches what is drawn.
 */

/** A footnote as it appears at the bottom of a sheet. */
export interface SheetFootnote {
  /** Number of the footnote in the document, starting at 1. */
  number: number;
  /** Text of the note. */
  text: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, character => HTML_ESCAPES[character] ?? character);

/** Class of the notes block; its look is defined in `document-content.css`. */
export const FOOTNOTES_CLASS = 'doc-footnotes';

/** HTML of the notes block of one sheet, or an empty string when the sheet has no footnotes. */
export const footnotesHtml = (notes: readonly SheetFootnote[]): string =>
  notes.length
    ? `<div class="${FOOTNOTES_CLASS}">${notes
        .map(note => `<p><sup>${note.number}</sup> ${escapeHtml(note.text)}</p>`)
        .join('')}</div>`
    : '';
