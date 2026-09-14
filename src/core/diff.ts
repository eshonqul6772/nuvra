/**
 * Comparison of two versions of a document. Blocks that did not change are kept as they are; a changed paragraph is
 * compared word by word, and blocks that were added or removed are shown whole. The result is display HTML with
 * `<ins>` and `<del>` marks, built from sanitised markup and escaped text.
 */
import { cleanEditorArtifacts, sanitizeHtml } from './engine/schema';

/** What changed between two versions. */
export interface DocumentComparison {
  /** Display HTML of the new version with insertions and deletions marked. */
  html: string;
  /** Number of inserted words, and of words in inserted blocks. */
  insertions: number;
  /** Number of deleted words, and of words in deleted blocks. */
  deletions: number;
}

/** A block of one version: its clean HTML, the text it compares by and whether its words can be compared. */
interface Block {
  html: string;
  tag: string;
  text: string;
  textual: boolean;
}

/** One step of a longest-common-subsequence alignment. */
type Step<T> = { kind: 'same'; a: T; b: T } | { kind: 'delete'; a: T } | { kind: 'insert'; b: T };

/** Tables of more cells than this are aligned greedily instead, keeping large documents fast. */
const MAX_LCS_CELLS = 4_000_000;

/** Blocks whose words are compared one by one. */
const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, character => HTML_ESCAPES[character] ?? character);

/** Words and the whitespace between them, so joining the tokens gives the text back. */
const tokenize = (text: string): string[] => text.split(/(\s+)/).filter(Boolean);

/** Number of words in a text. */
const countWords = (text: string): number => tokenize(text).filter(token => token.trim() !== '').length;

/**
 * Aligns two sequences by their longest common subsequence. Sequences too long for the table fall back to deleting
 * the old one and inserting the new one after their common start and end.
 */
const align = <T>(a: readonly T[], b: readonly T[], equal: (x: T, y: T) => boolean): Step<T>[] => {
  let start = 0;
  while (start < a.length && start < b.length && equal(a[start] as T, b[start] as T)) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && equal(a[endA - 1] as T, b[endB - 1] as T)) {
    endA -= 1;
    endB -= 1;
  }
  const head: Step<T>[] = a.slice(0, start).map((item, index) => ({ kind: 'same', a: item, b: b[index] as T }));
  const tail: Step<T>[] = a.slice(endA).map((item, index) => ({ kind: 'same', a: item, b: b[endB + index] as T }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: Step<T>[];
  if ((midA.length + 1) * (midB.length + 1) > MAX_LCS_CELLS) {
    middle = [
      ...midA.map(item => ({ kind: 'delete', a: item }) as Step<T>),
      ...midB.map(item => ({ kind: 'insert', b: item }) as Step<T>)
    ];
  } else {
    const rows = midA.length;
    const columns = midB.length;
    const table = new Uint32Array((rows + 1) * (columns + 1));
    const at = (row: number, column: number) => row * (columns + 1) + column;
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let column = columns - 1; column >= 0; column -= 1) {
        table[at(row, column)] = equal(midA[row] as T, midB[column] as T)
          ? (table[at(row + 1, column + 1)] ?? 0) + 1
          : Math.max(table[at(row + 1, column)] ?? 0, table[at(row, column + 1)] ?? 0);
      }
    }
    middle = [];
    let row = 0;
    let column = 0;
    while (row < rows && column < columns) {
      if (equal(midA[row] as T, midB[column] as T)) {
        middle.push({ kind: 'same', a: midA[row] as T, b: midB[column] as T });
        row += 1;
        column += 1;
      } else if ((table[at(row + 1, column)] ?? 0) >= (table[at(row, column + 1)] ?? 0)) {
        middle.push({ kind: 'delete', a: midA[row] as T });
        row += 1;
      } else {
        middle.push({ kind: 'insert', b: midB[column] as T });
        column += 1;
      }
    }
    for (; row < rows; row += 1) middle.push({ kind: 'delete', a: midA[row] as T });
    for (; column < columns; column += 1) middle.push({ kind: 'insert', b: midB[column] as T });
  }
  return [...head, ...middle, ...tail];
};

/** Top-level blocks of a version, cleaned the way saved HTML is. */
const readBlocks = (html: string): Block[] => {
  const container = document.createElement('div');
  container.append(sanitizeHtml(html));
  cleanEditorArtifacts(container, true);
  return Array.from(container.children)
    .map(element => ({
      html: element.outerHTML,
      tag: element.tagName,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      textual: TEXT_BLOCKS.has(element.tagName)
    }))
    .filter((block, index, all) => {
      // The empty paragraph the editor keeps at the end is not content.
      const last = index === all.length - 1;
      return !(last && block.tag === 'P' && block.html === '<p></p>');
    });
};

/** Opening tag of a block's HTML, so compared words keep the block's kind, alignment and indents. */
const openingTag = (html: string): string => /^<[^>]+>/.exec(html)?.[0] ?? '<p>';

/** A block shown as a whole insertion or deletion. */
const wholeBlock = (block: Block, kind: 'ins' | 'del'): string =>
  `<div class="doc-diff-block doc-diff-block--${kind}">${block.html}</div>`;

/** A paragraph compared word by word: the new block's tag with the changed words marked. */
const compareWords = (before: Block, after: Block, counts: { insertions: number; deletions: number }): string => {
  const steps = align(tokenize(before.text), tokenize(after.text), (x, y) => x === y);
  let html = '';
  for (const step of steps) {
    if (step.kind === 'same') {
      html += escapeHtml(step.a);
    } else if (step.kind === 'delete') {
      if (step.a.trim()) counts.deletions += 1;
      html += `<del class="doc-diff-del">${escapeHtml(step.a)}</del>`;
    } else {
      if (step.b.trim()) counts.insertions += 1;
      html += `<ins class="doc-diff-ins">${escapeHtml(step.b)}</ins>`;
    }
  }
  // Neighbouring marks of the same kind read as one change.
  html = html.replace(/<\/del><del class="doc-diff-del">/g, '').replace(/<\/ins><ins class="doc-diff-ins">/g, '');
  const tag = after.tag.toLowerCase();
  return `${openingTag(after.html)}${html}</${tag}>`;
};

/** Compares two versions of a document and marks what was inserted and deleted in the new one. */
export const compareDocuments = (before: string, after: string): DocumentComparison => {
  const counts = { insertions: 0, deletions: 0 };
  const steps = align(readBlocks(before), readBlocks(after), (x, y) => x.html === y.html);
  const output: string[] = [];

  // Runs of removed and added blocks between unchanged ones: paragraphs of the same kind are paired up and compared
  // word by word, everything else is shown whole.
  let deleted: Block[] = [];
  let inserted: Block[] = [];
  const flush = () => {
    const pairs = Math.min(deleted.length, inserted.length);
    for (let index = 0; index < Math.max(deleted.length, inserted.length); index += 1) {
      const a = deleted[index];
      const b = inserted[index];
      if (index < pairs && a && b && a.textual && b.textual && a.tag === b.tag) {
        output.push(compareWords(a, b, counts));
        continue;
      }
      if (a) {
        counts.deletions += countWords(a.text);
        output.push(wholeBlock(a, 'del'));
      }
      if (b) {
        counts.insertions += countWords(b.text);
        output.push(wholeBlock(b, 'ins'));
      }
    }
    deleted = [];
    inserted = [];
  };

  for (const step of steps) {
    if (step.kind === 'same') {
      flush();
      output.push(step.b.html);
    } else if (step.kind === 'delete') {
      deleted.push(step.a);
    } else {
      inserted.push(step.b);
    }
  }
  flush();
  return { html: output.join(''), ...counts };
};
