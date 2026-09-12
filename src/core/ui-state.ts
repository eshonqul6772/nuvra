import { type TextAlign, type TextDirection, paragraphIndents, paragraphSpacing } from './engine/blocks';
import { closestTag, closestTextBlock } from './engine/dom';
import { activeListKind } from './engine/lists';
import {
  type MarkName,
  type PendingFormat,
  isMarkActive,
  linkAncestor,
  readHighlight,
  readStyle,
  selectedTextNodes
} from './engine/marks';

/**
 * Flat snapshot of everything the toolbar renders. Components receive this instead of the engine so they
 * re-render only when a visible value changes, not on every keystroke.
 */
export interface EditorUiState {
  /** Heading level of the current block, `0` for a paragraph. */
  headingLevel: number;
  /** Font family at the selection without quotes, empty for the document default. */
  fontFamily: string;
  /** Font size at the selection (e.g. `14pt`), empty for the document default. */
  fontSize: string;
  /** Line spacing of the current paragraph, empty for the default. */
  lineHeight: string;
  /** Space before the current paragraph in points; `0` when it uses the document default. */
  spaceBefore: number;
  /** Space after the current paragraph in points; `0` when it uses the document default. */
  spaceAfter: number;
  /** Left indent of the current paragraph in pixels, as shown by the ruler. */
  indentLeft: number;
  /** Right indent of the current paragraph in pixels. */
  indentRight: number;
  /** First line indent of the current paragraph in pixels; negative values hang the line out. */
  indentFirstLine: number;
  /** Text color at the selection, empty for the default. */
  color: string;
  /** Highlight color at the selection, empty when not highlighted. */
  highlight: string;
  /** Alignment of the current paragraph. */
  align: TextAlign;
  /** Writing direction of the current paragraph. */
  direction: TextDirection;
  /** Whether the selection is bold. */
  bold: boolean;
  /** Whether the selection is italic. */
  italic: boolean;
  /** Whether the selection is underlined. */
  underline: boolean;
  /** Whether the selection is struck through. */
  strike: boolean;
  /** Whether the selection is inline code. */
  code: boolean;
  /** Whether the selection is subscript. */
  subscript: boolean;
  /** Whether the selection is superscript. */
  superscript: boolean;
  /** Whether the selection is inside a link. */
  link: boolean;
  /** Whether the selection is in a bulleted list. */
  bulletList: boolean;
  /** Whether the selection is in a numbered list. */
  orderedList: boolean;
  /** Whether the selection is in a task list. */
  taskList: boolean;
  /** Whether the selection is inside a quote. */
  blockquote: boolean;
  /** Whether the selection is inside a code block. */
  codeBlock: boolean;
  /** Whether there is an undo step. */
  canUndo: boolean;
  /** Whether there is a redo step. */
  canRedo: boolean;
  /** Whether the format painter carries a copied format and waits for the text to paint. */
  formatPainter: boolean;
}

/** Everything {@link readUiState} needs to know about the editor. */
interface UiStateSource {
  /** Editable document root. */
  root: HTMLElement;
  /** Current or last selection, `null` when the document never had one. */
  range: Range | null;
  /** Formatting chosen at a collapsed caret for the next typed text. */
  pending: PendingFormat | null;
  /** Whether there is an undo step. */
  canUndo: boolean;
  /** Whether there is a redo step. */
  canRedo: boolean;
}

/** State shown before the editor exists or while nothing is selected. */
export const EMPTY_UI_STATE: EditorUiState = {
  headingLevel: 0,
  fontFamily: '',
  fontSize: '',
  lineHeight: '',
  spaceBefore: 0,
  spaceAfter: 0,
  indentLeft: 0,
  indentRight: 0,
  indentFirstLine: 0,
  color: '',
  highlight: '',
  align: 'left',
  direction: 'auto',
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  subscript: false,
  superscript: false,
  link: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockquote: false,
  codeBlock: false,
  canUndo: false,
  canRedo: false,
  formatPainter: false
};

/** Marks reported to the toolbar. */
const MARKS: MarkName[] = ['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript'];

/** Font families compare without quotes: browsers re-serialise `'Times New Roman'` as `"Times New Roman"`. */
export const normalizeFontFamily = (value: string): string =>
  value
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ', ')
    .trim();

/** Alignment of a text block; left is the default and is never stored. */
const readAlignment = (block: HTMLElement | null): TextAlign => {
  const value = block?.style.textAlign ?? '';
  return value === 'center' || value === 'right' || value === 'justify' ? value : 'left';
};

/** Explicit direction of a text block; blocks without `dir` follow their own text. */
const readDirection = (block: HTMLElement | null): TextDirection => {
  const value = block?.getAttribute('dir');
  return value === 'rtl' || value === 'ltr' ? value : 'auto';
};

/**
 * Reads the toolbar state at a selection. Marks must cover the whole selection to count as active; styles and
 * block properties come from its first text. At a collapsed caret pending formatting overrides the document.
 */
export const readUiState = ({ root, range, pending, canUndo, canRedo }: UiStateSource): EditorUiState => {
  if (!range) return { ...EMPTY_UI_STATE, canUndo, canRedo };
  const anchor = range.collapsed ? range.startContainer : (selectedTextNodes(root, range)[0] ?? range.startContainer);
  const block = closestTextBlock(anchor, root);
  const marks = Object.fromEntries(MARKS.map(mark => [mark, isMarkActive(root, range, mark)])) as Record<
    MarkName,
    boolean
  >;
  const styles = {
    color: readStyle(root, anchor, 'color'),
    fontFamily: normalizeFontFamily(readStyle(root, anchor, 'fontFamily')),
    fontSize: readStyle(root, anchor, 'fontSize')
  };
  let highlight = readHighlight(root, anchor);

  if (range.collapsed && pending) {
    Object.assign(marks, pending.marks);
    for (const [name, value] of Object.entries(pending.styles)) {
      styles[name as keyof typeof styles] = name === 'fontFamily' ? normalizeFontFamily(value ?? '') : (value ?? '');
    }
    if (pending.highlight !== undefined) highlight = pending.highlight ?? '';
  }

  const indents = block ? paragraphIndents(block) : { left: 0, right: 0, firstLine: 0 };
  const listKind = activeListKind(root, anchor);
  const headingLevel = block && /^H[1-6]$/.test(block.tagName) ? Number(block.tagName[1]) : 0;

  return {
    ...marks,
    ...styles,
    headingLevel,
    highlight,
    lineHeight: block?.style.lineHeight ?? '',
    spaceBefore: block ? paragraphSpacing(block, 'before') : 0,
    spaceAfter: block ? paragraphSpacing(block, 'after') : 0,
    indentLeft: indents.left,
    indentRight: indents.right,
    indentFirstLine: indents.firstLine,
    align: readAlignment(block),
    direction: readDirection(block),
    link: linkAncestor(anchor, root) !== null,
    bulletList: listKind === 'bulletList',
    orderedList: listKind === 'orderedList',
    taskList: listKind === 'taskList',
    blockquote: closestTag(anchor, root, 'BLOCKQUOTE') !== null,
    codeBlock: block?.tagName === 'PRE',
    canUndo,
    canRedo,
    formatPainter: false
  };
};

/** Shallow comparison used to skip toolbar re-renders when nothing visible changed. */
export const isSameUiState = (a: EditorUiState, b: EditorUiState): boolean =>
  (Object.keys(a) as Array<keyof EditorUiState>).every(key => a[key] === b[key]);
