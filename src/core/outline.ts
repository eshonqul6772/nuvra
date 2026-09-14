/**
 * The outline of a document: its headings, the navigation panel built from them, and the table of contents. The table
 * of contents is a borderless `<table data-type="toc">` of ordinary content, so it prints and exports to Word like any
 * other table and can be refreshed after the headings or the page breaks change.
 */

/** A heading of the document. */
export interface OutlineHeading {
  /** Heading level, 1 to 6. */
  level: number;
  /** Heading text with collapsed whitespace. */
  text: string;
  /** The heading element in the editable document. */
  element: HTMLElement;
}

/** What the navigation panel lists: the headings, or thumbnails of the pages. */
export type OutlineView = 'headings' | 'pages';

/** A line of the table of contents. */
export interface TableOfContentsEntry {
  /** Heading level, 1 to 6; deeper levels are indented. */
  level: number;
  /** Heading text. */
  text: string;
  /** Page the heading starts on, or `null` when the document is not laid out in pages. */
  page: number | null;
}

/** Options of {@link buildTableOfContents}. */
export interface TableOfContentsOptions {
  /** Title written above the entries. */
  title: string;
  /** Text shown instead of the entries when the document has no headings. */
  emptyText: string;
  /** Width of the text column in pixels; the table spans it plus the page number column. */
  width?: number;
}

/** Marks the table of contents among the tables of a document. */
export const TABLE_OF_CONTENTS_TYPE = 'toc';

/** Selector of the table of contents. */
export const TABLE_OF_CONTENTS_SELECTOR = `table[data-type="${TABLE_OF_CONTENTS_TYPE}"]`;

/** Deepest heading level the table of contents lists by default. */
export const TABLE_OF_CONTENTS_DEPTH = 3;

/** Indentation of one heading level in the table of contents, in pixels. */
const LEVEL_INDENT_PX = 24;

/** Width of the page number column, in pixels. */
const PAGE_COLUMN_PX = 56;

/** Characters escaped when text is placed into HTML. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, character => HTML_ESCAPES[character] ?? character);

/** Headings written directly in the document, not inside tables, lists or quotes, in document order. */
export const readOutline = (root: HTMLElement, depth = 6): OutlineHeading[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')
  )
    .map(element => ({
      level: Number(element.tagName.slice(1)),
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      element
    }))
    .filter(heading => heading.level <= depth && heading.text !== '');

/** HTML of a table of contents: the title, then one row per heading with its page number on the right. */
export const buildTableOfContents = (entries: TableOfContentsEntry[], options: TableOfContentsOptions): string => {
  const { title, emptyText, width } = options;
  const colgroup =
    width && width > PAGE_COLUMN_PX * 2
      ? `<colgroup><col style="width: ${Math.round(width - PAGE_COLUMN_PX)}px"><col style="width: ${PAGE_COLUMN_PX}px"></colgroup>`
      : '';
  const top = Math.min(...entries.map(entry => entry.level), 6);
  const rows = entries.length
    ? entries
        .map(entry => {
          const indent = (entry.level - top) * LEVEL_INDENT_PX;
          const style = indent > 0 ? ` style="margin-left: ${indent}px"` : '';
          const text = entry.level === top ? `<strong>${escapeHtml(entry.text)}</strong>` : escapeHtml(entry.text);
          const page = entry.page === null ? '' : String(entry.page);
          return `<tr><td><p${style}>${text}</p></td><td><p style="text-align: right">${page}</p></td></tr>`;
        })
        .join('')
    : `<tr><td><p><em>${escapeHtml(emptyText)}</em></p></td><td><p></p></td></tr>`;
  return `<table data-type="${TABLE_OF_CONTENTS_TYPE}">${colgroup}<tbody><tr><td colspan="2"><p style="text-align: center"><strong>${escapeHtml(title)}</strong></p></td></tr>${rows}</tbody></table>`;
};
