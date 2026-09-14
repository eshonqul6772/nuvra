import { parseAmount } from '../numbers';
import { type OutlineHeading, TABLE_OF_CONTENTS_SELECTOR, readOutline } from '../outline';
import { type TransliterationDirection, transliterate } from '../transliterate';
import { type EditorUiState, readUiState } from '../ui-state';
import {
  type HeadingTag,
  type ParagraphIndents,
  type SpacingSide,
  type TextAlign,
  type TextDirection,
  changeIndent,
  insertBlockAtCaret,
  setBlockType,
  setLineHeight,
  setParagraphIndents,
  setParagraphSpacing,
  setTextAlign,
  setTextDirection,
  splitBlock,
  toggleBlockquote,
  toggleCodeBlock
} from './blocks';
import {
  type TransferContent,
  imageFiles,
  rangeFromPoint,
  readTransfer,
  selectionClipboardData,
  singleUrl,
  textToFragment,
  transferToFragment,
  writeTransfer
} from './clipboard';
import {
  FOOTNOTE_ATTRIBUTE,
  FOOTNOTE_SELECTOR,
  MAX_FOOTNOTE_LENGTH,
  VARIABLE_ATTRIBUTE,
  VARIABLE_SELECTOR,
  closestTag,
  closestTextBlock,
  createElement,
  createFootnote,
  createParagraph,
  createVariable,
  isEmptyTextBlock,
  isText,
  isTextBlock,
  mergeAdjacentMarks,
  syncTrailingBreak,
  textBlocksInRange,
  textBlocksWithin,
  unwrap
} from './dom';
import {
  type Caret,
  adjacentInlineAtom,
  deleteRange,
  endCaret,
  insertFragment,
  insertInlineAtCaret,
  insertLineBreak,
  insertTextAtCaret,
  isCaretAtBlockEnd,
  isCaretAtBlockStart,
  joinBackward,
  joinForward,
  splitAtCaret,
  startCaret
} from './editing';
import { EditorHistory, type Snapshot } from './history';
import { matchInputRule } from './input-rules';
import { type KeyCommand, matchKeyCommand } from './keymap';
import { type ListKind, changeListIndent, closestListItem, liftOutOfLists, toggleList } from './lists';
import {
  CHANGE_ATTRIBUTE,
  CHANGE_SELECTOR,
  COMMENT_ATTRIBUTE,
  COMMENT_ID,
  COMMENT_SELECTOR,
  type ChangeMark,
  type MarkName,
  type PendingFormat,
  type StyleName,
  type TextCase,
  addCommentAnchor,
  applyTextCase,
  clearMarks,
  deletionAncestor,
  insertFormattedText,
  linkAncestor,
  markDeleted,
  markInserted,
  readHighlight,
  readMarks,
  readStyle,
  resolveChanges,
  selectedTextNodes,
  setHighlight,
  setLink,
  setTextStyle,
  toggleMark,
  transformSelectedText,
  unsetLink
} from './marks';
import {
  VARIABLE_LABEL_ATTRIBUTE,
  VARIABLE_NAME,
  cleanEditorArtifacts,
  isBlockNode,
  isEmptyDocument,
  normalizeContainer,
  sanitizeHtml,
  sanitizeUrl,
  serialize,
  setIndent
} from './schema';
import { SearchController, type SearchState } from './search';
import {
  type TextBookmark,
  bookmarkToRange,
  getRangeWithin,
  placeCaretAtEnd,
  placeCaretAtStart,
  rangeToBookmark,
  restoreBookmark,
  saveBookmark,
  scrollSelectionIntoView,
  selectRange
} from './selection';
import {
  type CellRect,
  type TableCell,
  addColumn,
  addRow,
  canMergeRect,
  canSplitCell,
  cellsInRect,
  createTable,
  deleteColumn,
  deleteRow,
  markSelectedCells,
  mergeCells,
  rectBetween,
  setColumnWidth,
  siblingCell,
  splitCell,
  toggleHeaderRow
} from './tables';

/** A tracked insertion or deletion; the parts of one edit are joined. */
export interface TrackedChange {
  /** Id shared by the parts of the edit. */
  id: string;
  /** Whether text was inserted or deleted. */
  type: 'insert' | 'delete';
  /** Name of the author; may be empty. */
  author: string;
  /** When the change was made, as an ISO 8601 string. */
  time: string;
  /** Inserted or deleted text. */
  text: string;
}

/** Settings the host component passes when it creates the engine. */
interface DocumentEngineOptions {
  /** Initial HTML; it is sanitised before it reaches the DOM. */
  content: string;
  /** Whether the user may change the document. */
  editable: boolean;
  /** Maximum number of characters in the document, or `0` for no limit. */
  maxLength: number;
  /** Returns the placeholder shown while the document is empty; called on every refresh so it follows the locale. */
  placeholder: () => string;
  /** Receives image files pasted or dropped into the document; the selection is already at the target. */
  onImageFiles: (files: File[]) => void;
  /**
   * Label a template variable chip shows, or `undefined` for a name the host does not know. Called on every refresh,
   * so labels follow the host's variable list and locale; typed `{{name}}` becomes a chip only for known names.
   */
  variableLabel?: (name: string) => string | undefined;
}

/** Events emitted by the engine, mapped to their payloads. */
interface EngineEvents {
  /** The document content changed. */
  update: undefined;
  /** The selection, pending formatting or anything else shown by the toolbar may have changed. */
  selection: undefined;
  /** The editable root received focus. */
  focus: undefined;
  /** The editable root lost focus. */
  blur: undefined;
  /** An IME composition started (`true`) or ended (`false`). */
  composition: boolean;
  /** The find results or the current match changed. */
  search: SearchState;
}

/** Table operations offered by the table menu. */
export type TableCommand =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'mergeCells'
  | 'splitCell'
  | 'toggleHeaderRow'
  | 'deleteTable';

/** Image attributes that can change after insertion; `null` or an empty value removes the attribute. */
interface ImageAttributes {
  /** Horizontal placement, stored as `data-align`. */
  align?: 'left' | 'center' | 'right';
  /** Alternative text for screen readers. */
  alt?: string | null;
  /** Rendered width in CSS pixels. */
  width?: number | null;
  /** Rendered height in CSS pixels. */
  height?: number | null;
}

/** Character and paragraph formatting picked up by the format painter. */
export interface CopiedFormat {
  /** Marks that were active on the copied text. */
  marks: Partial<Record<MarkName, boolean>>;
  /** Span styles of the copied text; empty values mean the document default. */
  styles: Partial<Record<StyleName, string>>;
  /** Highlight colour of the copied text, empty when it was not highlighted. */
  highlight: string;
  /** Tag of the copied block, so headings are painted as headings. */
  tag: 'P' | HeadingTag;
  /** Alignment of the copied paragraph. */
  align: TextAlign;
  /** Line spacing of the copied paragraph, empty for the default. */
  lineHeight: string;
  /** Indentation steps of the copied paragraph. */
  indent: number;
}

/**
 * Result of an edit callback: the new caret, a text bookmark, `undefined` to keep the previous selection, or `null`
 * when nothing changed and no undo step may be recorded.
 */
type EditResult = Caret | TextBookmark | undefined | null;

/** Callback registered with {@link DocumentEngine.on}. */
type Listener<T> = (payload: T) => void;

/** Table cell tags, used to find the cell around a node. */
const CELL_TAGS = new Set(['TD', 'TH']);
/** Blocks that can hold the caret, used when moving between table cells. */
const TEXT_BLOCK_QUERY = 'p, h1, h2, h3, h4, h5, h6, pre';
/** A selectionchange arriving this soon after an edit was caused by the edit, not by the user. */
const INTERNAL_SELECTION_MS = 150;
/** Highlight colour applied by the keyboard shortcut. */
const DEFAULT_HIGHLIGHT_COLOR = '#fef08a';
/** `MouseEvent.button` value of the primary button. */
const PRIMARY_BUTTON = 0;
/** `MouseEvent.buttons` bit that is set while the primary button is held. */
const PRIMARY_BUTTON_MASK = 1;
/** Inline styles carried over to a new empty line after Enter. */
const CARRIED_STYLES: StyleName[] = ['color', 'fontFamily', 'fontSize'];

/** Tells a caret apart from a text bookmark. */
const isCaret = (value: Caret | TextBookmark): value is Caret => 'node' in value;

/**
 * Framework-free rich text engine on top of a `contenteditable` element. It owns the browser events, keeps the
 * document well-formed, records undo history and exposes every editing command the toolbar and menus need.
 */
export class DocumentEngine {
  /** Undo and redo stacks of document snapshots. */
  readonly history = new EditorHistory();
  /** Find and replace over the document text. */
  readonly search: SearchController;

  /** Registered listeners per event. */
  private readonly listeners = new Map<keyof EngineEvents, Set<Listener<never>>>();
  /** Removes every DOM listener added by the engine. */
  private readonly disposers: Array<() => void> = [];
  /** Whether the user may change the document. */
  private editable: boolean;
  /** Whether an IME composition is in progress. */
  private composingText = false;
  /** Last selection inside the document, used when focus is in a toolbar popover. */
  private lastRange: Range | null = null;
  /** Formatting chosen at a collapsed caret, applied to the next typed text. */
  private pending: PendingFormat | null = null;
  /** Time until which selection changes are attributed to the engine itself. */
  private internalSelectionUntil = 0;
  /** Cell where a mouse drag for a cell selection started. */
  private cellAnchor: TableCell | null = null;
  /** Rectangle of selected table cells, when several cells are selected. */
  private cellRect: CellRect | null = null;
  /** Selection being dragged, so a drop inside the document can move instead of copy. */
  private dragRange: Range | null = null;
  /** Image selected by a click, shown with resize handles. */
  private selectedImageElement: HTMLImageElement | null = null;
  /** Formatting the format painter carries until it is painted onto a selection. */
  private painterFormat: CopiedFormat | null = null;
  /** Author of tracked changes while changes are tracked, otherwise `null`. */
  private trackingAuthor: string | null = null;
  /** Change the running typing group adds to, so typed characters form one insertion. */
  private typingChange: ChangeMark | null = null;

  /**
   * Takes over `root` as the editable document, loads the initial content and starts listening to its events.
   *
   * @param root Element that becomes the editable document.
   * @param options Initial content, limits and callbacks.
   */
  constructor(
    readonly root: HTMLElement,
    private readonly options: DocumentEngineOptions
  ) {
    this.editable = options.editable;
    this.search = new SearchController(root, state => this.emit('search', state));
    root.classList.add('doc-content');
    root.setAttribute('role', 'textbox');
    root.setAttribute('aria-multiline', 'true');
    root.spellcheck = true;
    root.contentEditable = String(options.editable);
    this.setContent(options.content);

    this.listen(root, 'beforeinput', this.onBeforeInput);
    this.listen(root, 'input', this.onInput);
    this.listen(root, 'keydown', this.onKeyDown);
    this.listen(root, 'paste', this.onPaste);
    this.listen(root, 'copy', this.onCopy);
    this.listen(root, 'cut', this.onCut);
    this.listen(root, 'dragstart', this.onDragStart);
    this.listen(root, 'dragend', this.onDragEnd);
    this.listen(root, 'dragover', this.onDragOver);
    this.listen(root, 'drop', this.onDrop);
    this.listen(root, 'mousedown', this.onMouseDown);
    this.listen(root, 'mousemove', this.onMouseMove);
    this.listen(root, 'click', this.onClick);
    this.listen(root, 'compositionstart', this.onCompositionStart);
    this.listen(root, 'compositionend', this.onCompositionEnd);
    this.listen(root, 'focus', () => this.emit('focus', undefined));
    this.listen(root, 'blur', () => this.emit('blur', undefined));
    this.listen(document, 'selectionchange', this.onSelectionChange);
    this.listen(document, 'mouseup', () => {
      this.cellAnchor = null;
      // The format painter paints once the user has finished choosing the target text.
      if (this.painterFormat) this.paintFormat();
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Events and lifecycle

  /**
   * Subscribes to an engine event.
   *
   * @returns Function that removes the listener again.
   */
  on<K extends keyof EngineEvents>(event: K, listener: Listener<EngineEvents[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<never>);
  }

  /** Removes all DOM listeners, event subscriptions and search highlights. The root element is left in place. */
  destroy(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.listeners.clear();
    this.search.clear();
  }

  /** Calls every listener of an event with its payload. */
  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as Listener<EngineEvents[K]>)(payload);
  }

  /** Adds a DOM listener that {@link destroy} removes again. */
  private listen(target: EventTarget, type: string, handler: (event: never) => void) {
    const listener = handler as unknown as EventListener;
    target.addEventListener(type, listener);
    this.disposers.push(() => target.removeEventListener(type, listener));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Content and state

  /** Whether the document holds nothing but one empty paragraph. */
  get isEmpty(): boolean {
    return isEmptyDocument(this.root);
  }

  /** Whether the user may change the document. */
  get isEditable(): boolean {
    return this.editable;
  }

  /** Whether an IME composition is in progress; layout work should wait until it ends. */
  get composing(): boolean {
    return this.composingText;
  }

  /** Image currently selected by a click, if it is still in the document. */
  get selectedImage(): HTMLImageElement | null {
    return this.selectedImageElement?.isConnected ? this.selectedImageElement : null;
  }

  /** Whether several table cells are selected with the mouse. */
  get hasCellSelection(): boolean {
    return this.cellRect !== null;
  }

  /** Clean HTML of the document, without caret placeholders or other editor-only markup. */
  getHTML(): string {
    return serialize(this.root);
  }

  /**
   * Replaces the whole document with sanitised HTML.
   *
   * @param html New content; scripts, handlers and unsupported markup are dropped.
   * @param options.addToHistory Record the replacement as an undo step instead of clearing the history.
   * @param options.emitUpdate Emit `update` so the host saves the new content.
   */
  setContent(html: string, { addToHistory = false, emitUpdate = false } = {}): void {
    const before = addToHistory ? this.snapshot() : null;
    this.root.replaceChildren(sanitizeHtml(html));
    normalizeContainer(this.root, true);
    if (before) this.history.record(() => before, 'command');
    else this.history.clear();
    this.pending = null;
    this.selectImage(null);
    this.clearCellSelection();
    this.refresh(emitUpdate);
  }

  /** Switches between editing and read-only mode. */
  setEditable(editable: boolean): void {
    this.editable = editable;
    this.root.contentEditable = String(editable);
    this.emit('selection', undefined);
  }

  /** Word and character counts of the document text. */
  getStats(): { words: number; characters: number } {
    const texts = this.blockTexts();
    return {
      characters: texts.reduce((sum, text) => sum + text.length, 0),
      words: texts.join(' ').split(/\s+/).filter(Boolean).length
    };
  }

  /** Snapshot of the formatting at the selection, for the toolbar. */
  getState(): EditorUiState {
    return {
      ...readUiState({
        root: this.root,
        range: this.currentRange(),
        pending: this.pending,
        canUndo: this.editable && this.history.canUndo,
        canRedo: this.editable && this.history.canRedo
      }),
      formatPainter: this.painterFormat !== null
    };
  }

  /** Plain text of the current selection. */
  getSelectedText(): string {
    return this.currentRange()?.toString() ?? '';
  }

  /**
   * Focuses the document.
   *
   * @param position Place the caret at the start or end; without it the last selection is restored.
   */
  focus(position?: 'start' | 'end'): void {
    this.expectInternalSelection();
    this.root.focus({ preventScroll: true });
    const blocks = textBlocksWithin(this.root);
    const first = blocks[0];
    const last = blocks.at(-1);
    if (position === 'start' && first) placeCaretAtStart(first);
    else if (position === 'end' && last) placeCaretAtEnd(last);
    else if (!getRangeWithin(this.root) && this.lastRange?.startContainer.isConnected) selectRange(this.lastRange);
  }

  /** Selects the whole document, as Ctrl/⌘+A does. */
  selectAll(): void {
    const range = document.createRange();
    range.selectNodeContents(this.root);
    this.expectInternalSelection();
    this.root.focus({ preventScroll: true });
    selectRange(range);
  }

  /** Copies the selection to the system clipboard as clean HTML and plain text. */
  async copySelection(): Promise<void> {
    const range = this.currentRange();
    if (!range || range.collapsed) return;
    const { html, text } = selectionClipboardData(this.root, range);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
    } catch {
      // Without the async clipboard, or without permission, the legacy command still copies the selection.
      document.execCommand('copy');
    }
  }

  /** Copies the selection and removes it as one undo step. */
  async cutSelection(): Promise<void> {
    if (!this.editable) return;
    await this.copySelection();
    this.deleteSelection();
  }

  /** Inserts the clipboard content at the selection; the browser asks for clipboard permission the first time. */
  async pasteFromClipboard(): Promise<void> {
    if (!this.editable || !navigator.clipboard?.read) return;
    let html = '';
    let text = '';
    try {
      for (const item of await navigator.clipboard.read()) {
        if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
    } catch {
      // Reading was refused; the keyboard shortcut shown next to the menu entry still works.
      return;
    }
    if (html || text) this.insertTransfer({ html, text, files: [] });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Edit pipeline

  /** Marks the next selection changes as caused by the engine, so they keep pending formatting and typing groups. */
  private expectInternalSelection() {
    this.internalSelectionUntil = performance.now() + INTERNAL_SELECTION_MS;
  }

  /** Live selection inside the document, or a copy of the last one while focus is elsewhere (e.g. in a popover). */
  private currentRange(): Range | null {
    const live = getRangeWithin(this.root);
    if (live) return live;
    const last = this.lastRange;
    return last && this.root.contains(last.startContainer) && this.root.contains(last.endContainer)
      ? last.cloneRange()
      : null;
  }

  /** Captures the document markup and selection for the undo history. */
  private snapshot(bookmark: TextBookmark | null = saveBookmark(this.root)): Snapshot {
    const clone = this.root.cloneNode(true) as HTMLElement;
    cleanEditorArtifacts(clone, false);
    return { blocks: Array.from(clone.children, child => child.outerHTML), bookmark };
  }

  /** Updates the placeholder state, variable labels and search results, then notifies listeners. */
  private refresh(emitUpdate = true) {
    this.root.classList.toggle('is-empty', this.isEmpty);
    this.root.style.setProperty('--doc-placeholder', JSON.stringify(this.options.placeholder()));
    this.updateVariableLabels();
    if (this.search.active) this.search.refresh();
    if (emitUpdate) this.emit('update', undefined);
    this.emit('selection', undefined);
  }

  /**
   * Runs one edit as an undo step, then normalises the document and restores the selection by text position.
   *
   * @param edit Changes the document at the given range and describes the resulting selection.
   * @param kind `typing` edits join the running typing group instead of always starting a new undo step.
   * @returns Whether the edit ran and changed something.
   */
  private exec(edit: (range: Range) => EditResult, kind: 'command' | 'typing' = 'command'): boolean {
    if (!this.editable) return false;
    const range = this.currentRange();
    if (!range) return false;
    const bookmark = rangeToBookmark(this.root, range);
    const before = kind === 'command' ? this.snapshot(bookmark) : null;
    if (kind === 'typing') this.history.record(() => this.snapshot(bookmark), 'typing');
    const result = edit(range);
    if (result === null) return false;
    if (before) this.history.record(() => before, 'command');
    this.finishEdit(result ?? bookmark);
    return true;
  }

  /** Normalises the document after an edit, restores the selection and notifies listeners. */
  private finishEdit(selection: Caret | TextBookmark) {
    let bookmark: TextBookmark | null = null;
    if (!isCaret(selection)) bookmark = selection;
    else if (selection.node.isConnected && this.root.contains(selection.node)) {
      const caret = document.createRange();
      caret.setStart(selection.node, selection.offset);
      bookmark = rangeToBookmark(this.root, caret);
    }
    normalizeContainer(this.root, true);
    this.expectInternalSelection();
    if (document.activeElement !== this.root) this.root.focus({ preventScroll: true });
    if (bookmark) restoreBookmark(this.root, bookmark);
    this.lastRange = getRangeWithin(this.root)?.cloneRange() ?? this.lastRange;
    this.refresh();
    scrollSelectionIntoView(this.root);
  }

  /** Records an undo step for a change that does not depend on the selection (checkboxes, image attributes). */
  private mutate(change: () => void) {
    if (!this.editable) return;
    const before = this.snapshot();
    change();
    this.history.record(() => before, 'command');
    this.refresh();
  }

  /**
   * Deletes the selected content, if any, and returns a collapsed range where the new content goes: where the selection
   * started, or after the text marked as deleted while changes are tracked.
   */
  private collapsedAfterDelete(range: Range, kind: 'command' | 'typing' = 'command'): Range {
    if (range.collapsed) return this.outsideDeletion(range);
    if (this.trackingAuthor !== null) return this.outsideDeletion(this.deleteTracked(range, 'end', kind));
    const { anchor } = rangeToBookmark(this.root, range);
    deleteRange(this.root, range);
    normalizeContainer(this.root, true);
    return bookmarkToRange(this.root, { anchor, focus: anchor });
  }

  /** Deletes the selection as one undo step and leaves a collapsed caret where it started. */
  private deleteSelection() {
    this.exec(target => {
      if (this.trackingAuthor !== null) {
        const caret = this.deleteTracked(target, 'start', 'command');
        return rangeToBookmark(this.root, caret);
      }
      const { anchor } = rangeToBookmark(this.root, target);
      deleteRange(this.root, target);
      return { anchor, focus: anchor };
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Tracked changes

  /** Whether edits are recorded as tracked changes. */
  get tracksChanges(): boolean {
    return this.trackingAuthor !== null;
  }

  /** Starts or stops recording typing, deleting and pasting as tracked changes by `author`. */
  setTrackChanges(enabled: boolean, author = ''): void {
    this.trackingAuthor = enabled ? author : null;
    this.typingChange = null;
    this.emit('selection', undefined);
  }

  /** A change mark for the next edit; typing keeps adding to one change until the caret moves. */
  private nextChange(kind: 'command' | 'typing'): ChangeMark {
    if (kind === 'typing' && this.typingChange) return this.typingChange;
    const mark: ChangeMark = {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      author: this.trackingAuthor ?? '',
      time: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    };
    this.typingChange = kind === 'typing' ? mark : null;
    return mark;
  }

  /**
   * Marks a range as deleted and returns a caret at its start or after it. A marker element keeps the end position
   * while own insertions inside the range are removed for real.
   */
  private deleteTracked(range: Range, caretAt: 'start' | 'end', kind: 'command' | 'typing'): Range {
    // Positions are taken before the marker goes in, so the range is rebuilt from them rather than kept live. The
    // marker is a <wbr>: it takes no position and, unlike an empty span, is not tidied away as an empty mark.
    const bookmark = rangeToBookmark(this.root, range);
    const from = Math.min(bookmark.anchor, bookmark.focus);
    const to = Math.max(bookmark.anchor, bookmark.focus);
    const marker = document.createElement('wbr');
    bookmarkToRange(this.root, {
      anchor: caretAt === 'start' ? from : to,
      focus: caretAt === 'start' ? from : to
    }).insertNode(marker);
    markDeleted(this.root, bookmarkToRange(this.root, { anchor: from, focus: to }), this.nextChange(kind));
    const caret = document.createRange();
    caret.setStartBefore(marker);
    const { anchor } = rangeToBookmark(this.root, caret);
    marker.remove();
    normalizeContainer(this.root, true);
    return bookmarkToRange(this.root, { anchor, focus: anchor });
  }

  /** Moves a caret that sits inside deleted text to its end, so new text never becomes part of a deletion. */
  private outsideDeletion(range: Range): Range {
    const deletion = this.trackingAuthor === null ? null : deletionAncestor(range.startContainer, this.root);
    if (!deletion) return range;
    const caret = document.createRange();
    caret.setStartAfter(deletion);
    caret.collapse(true);
    return caret;
  }

  /** Marks the text between two document positions as inserted by the tracking author. */
  private markInsertedBetween(from: number, to: number, kind: 'command' | 'typing') {
    if (this.trackingAuthor === null || to <= from) return;
    markInserted(this.root, bookmarkToRange(this.root, { anchor: from, focus: to }), this.nextChange(kind));
  }

  /** Tracked insertions and deletions in document order, the parts of one edit grouped by id and kind. */
  getChanges(): TrackedChange[] {
    const changes = new Map<string, TrackedChange>();
    for (const element of Array.from(this.root.querySelectorAll<HTMLElement>(CHANGE_SELECTOR))) {
      const id = element.getAttribute(CHANGE_ATTRIBUTE) ?? '';
      const type = element.tagName === 'INS' ? 'insert' : 'delete';
      const key = `${type}:${id}`;
      const known = changes.get(key);
      const text = element.textContent ?? '';
      if (known) known.text += text;
      else
        changes.set(key, {
          id,
          type,
          author: element.getAttribute('data-author') ?? '',
          time: element.getAttribute('data-time') ?? '',
          text
        });
    }
    return [...changes.values()];
  }

  /** Accepts (`true`) or rejects the tracked changes with the given id, or every change without one, as an undo step. */
  resolveChanges(accept: boolean, id?: string): void {
    const elements = Array.from(this.root.querySelectorAll<HTMLElement>(CHANGE_SELECTOR)).filter(
      element => id === undefined || element.getAttribute(CHANGE_ATTRIBUTE) === id
    );
    if (!elements.length) return;
    this.mutate(() => {
      resolveChanges(elements, accept);
      normalizeContainer(this.root, true);
    });
  }

  /** Selects the text of a tracked change and scrolls it into view. */
  selectChange(id: string): void {
    const parts = Array.from(this.root.querySelectorAll<HTMLElement>(CHANGE_SELECTOR)).filter(
      element => element.getAttribute(CHANGE_ATTRIBUTE) === id
    );
    const first = parts[0];
    const last = parts.at(-1);
    if (!first || !last) return;
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    first.scrollIntoView({ block: 'center' });
    this.root.focus({ preventScroll: true });
    selectRange(range);
  }

  /** Number of characters in the document text. */
  private characterCount(): number {
    return this.blockTexts().reduce((sum, text) => sum + text.length, 0);
  }

  /** Text of every block as the document reads once its tracked changes are accepted: deleted text is left out. */
  private blockTexts(): string[] {
    const hasDeletions = this.root.querySelector(`del[${CHANGE_ATTRIBUTE}]`) !== null;
    return textBlocksWithin(this.root).map(block => {
      if (!hasDeletions) return block.textContent ?? '';
      const copy = block.cloneNode(true) as HTMLElement;
      for (const deletion of Array.from(copy.querySelectorAll(`del[${CHANGE_ATTRIBUTE}]`))) deletion.remove();
      return copy.textContent ?? '';
    });
  }

  /** Whether adding `extra` characters would exceed the configured maximum length. */
  private exceedsLimit(extra: number) {
    return this.options.maxLength > 0 && this.characterCount() + extra > this.options.maxLength;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Browser events

  /** Remembers the selection; a selection moved by the user drops pending formatting and ends the typing group. */
  private onSelectionChange = () => {
    const range = getRangeWithin(this.root);
    if (!range) return;
    this.lastRange = range.cloneRange();
    if (performance.now() > this.internalSelectionUntil) {
      this.pending = null;
      this.history.breakGroup();
      this.typingChange = null;
    }
    this.emit('selection', undefined);
  };

  /** Decides for every input whether the browser may apply it natively or the engine performs it instead. */
  private onBeforeInput = (event: InputEvent) => {
    if (!this.editable) {
      event.preventDefault();
      return;
    }
    const type = event.inputType;
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (type === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    // Native formatting is replaced by the engine's commands; paste and drop have their own handlers.
    if (type.startsWith('format') || type === 'insertFromPaste' || type === 'insertFromDrop') {
      event.preventDefault();
      return;
    }
    if (this.cellRect && (type.startsWith('delete') || type.startsWith('insert'))) {
      event.preventDefault();
      if (type.startsWith('delete')) this.clearSelectedCells();
      return;
    }
    const range = getRangeWithin(this.root);
    if (!range || this.composingText || type === 'insertCompositionText') return;
    this.expectInternalSelection();

    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      this.splitLine(type === 'insertLineBreak');
    } else if (type === 'insertText' || type === 'insertReplacementText') {
      this.handleTextInput(event, range);
    } else if (type.startsWith('delete')) {
      this.handleDeleteInput(event, range);
    }
  };

  /**
   * Lets the browser type plain characters itself (fast and IME friendly) and takes over when a selection has to be
   * replaced, pending formatting applies or the caret sits outside a text block.
   */
  private handleTextInput(event: InputEvent, range: Range) {
    const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    if (this.exceedsLimit(text.length)) {
      event.preventDefault();
      return;
    }
    const block = closestTextBlock(range.startContainer, this.root);
    if (this.trackingAuthor !== null) {
      event.preventDefault();
      this.insertText(text);
      return;
    }
    if (event.inputType === 'insertText' && (!range.collapsed || this.pending || !block)) {
      event.preventDefault();
      this.insertText(text);
      return;
    }
    this.history.record(() => this.snapshot(), 'typing');
  }

  /** Deletes selections and joins blocks at their edges itself; single characters are deleted natively. */
  private handleDeleteInput(event: InputEvent, range: Range) {
    if (!range.collapsed) {
      event.preventDefault();
      this.deleteSelection();
      return;
    }
    const block = closestTextBlock(range.startContainer, this.root);
    const backward = event.inputType.includes('Backward');
    const chip = adjacentInlineAtom(this.root, range, backward);
    if (chip) {
      // Browsers disagree on deleting non-editable inline elements, so a chip is removed like one character.
      event.preventDefault();
      const { anchor } = rangeToBookmark(this.root, range);
      const position = backward ? anchor - 1 : anchor;
      this.exec(() => {
        chip.remove();
        return { anchor: position, focus: position };
      }, 'typing');
      return;
    }
    if (block && (backward ? isCaretAtBlockStart(block, range) : isCaretAtBlockEnd(block, range))) {
      event.preventDefault();
      this.exec(() => (backward ? joinBackward(this.root, block) : joinForward(this.root, block)));
      return;
    }
    if (this.trackingAuthor !== null) {
      event.preventDefault();
      this.deleteTrackedAtCaret(range, backward, event.inputType);
      return;
    }
    this.history.record(() => this.snapshot(), 'typing');
  }

  /**
   * Marks the character, word or line next to the caret as deleted. Text that is already marked as deleted is
   * stepped over, as in Word, instead of being deleted again.
   */
  private deleteTrackedAtCaret(range: Range, backward: boolean, inputType: string) {
    const granularity = /Word/.test(inputType) ? 'word' : /Line/.test(inputType) ? 'lineboundary' : 'character';
    const extended = this.extendCaret(range, backward, granularity);
    if (!extended || extended.collapsed) return;
    const allDeleted = selectedTextNodes(this.root, extended).every(node => deletionAncestor(node, this.root));
    if (allDeleted) {
      const bookmark = rangeToBookmark(this.root, extended);
      const position = backward ? Math.min(bookmark.anchor, bookmark.focus) : Math.max(bookmark.anchor, bookmark.focus);
      this.expectInternalSelection();
      restoreBookmark(this.root, { anchor: position, focus: position });
      this.emit('selection', undefined);
      return;
    }
    this.exec(
      () => rangeToBookmark(this.root, this.deleteTracked(extended, backward ? 'start' : 'end', 'typing')),
      'typing'
    );
  }

  /** The range from a caret to the next character, word or line boundary in one direction. */
  private extendCaret(
    range: Range,
    backward: boolean,
    granularity: 'character' | 'word' | 'lineboundary'
  ): Range | null {
    const selection = document.getSelection();
    if (selection && typeof selection.modify === 'function' && selection.rangeCount) {
      selection.modify('extend', backward ? 'backward' : 'forward', granularity);
      const extended = selection.getRangeAt(0).cloneRange();
      this.expectInternalSelection();
      selectRange(range);
      if (!extended.collapsed) return this.root.contains(extended.commonAncestorContainer) ? extended : null;
    }
    // Without a working Selection.modify one character is deleted.
    const { anchor } = rangeToBookmark(this.root, range);
    const other = backward ? anchor - 1 : anchor + 1;
    if (other < 0) return null;
    return bookmarkToRange(this.root, { anchor: Math.min(anchor, other), focus: Math.max(anchor, other) });
  }

  /** Repairs the structure after a native edit and applies Markdown and typography rules to typed text. */
  private onInput = (event: Event) => {
    this.expectInternalSelection();
    this.repairStructure();
    const { inputType, data } = event as InputEvent;
    if (!this.composingText && inputType === 'insertText' && data) this.applyInputRule(data);
    this.refresh();
  };

  /** Browsers occasionally leave text outside paragraphs or a <div> after native edits; fix it in place. */
  private repairStructure() {
    const broken =
      !this.root.firstChild ||
      Array.from(this.root.childNodes).some(
        node => !isBlockNode(node) || (node.tagName === 'DIV' && node.getAttribute('data-type') !== 'page-break')
      );
    if (broken) {
      const bookmark = saveBookmark(this.root);
      normalizeContainer(this.root, true);
      if (bookmark) restoreBookmark(this.root, bookmark);
      return;
    }
    const block = closestTextBlock(getRangeWithin(this.root)?.startContainer, this.root);
    if (block && block.tagName !== 'PRE') syncTrailingBreak(block);
  }

  /** Applies the input rule completed by the typed character as its own undo step. */
  private applyInputRule(typed: string) {
    const range = getRangeWithin(this.root);
    const isKnownVariable = (name: string) => this.options.variableLabel?.(name) !== undefined;
    const rule = range ? matchInputRule(this.root, range, typed, isKnownVariable) : null;
    if (!rule) return;
    let pending: PendingFormat | undefined;
    this.exec(() => {
      const result = rule();
      pending = result.pending;
      return result.caret ?? undefined;
    });
    if (pending) this.pending = pending;
  }

  /** Runs keyboard shortcuts and handles Delete, Tab and Escape for images, cell selections, tables and lists. */
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || this.composingText) return;
    const command = matchKeyCommand(event);
    if (command) {
      event.preventDefault();
      this.runKeyCommand(command);
      return;
    }
    if (!this.editable) return;
    const deleting = event.key === 'Backspace' || event.key === 'Delete';
    if (deleting && this.selectedImage) {
      event.preventDefault();
      this.removeImage(this.selectedImage);
    } else if (deleting && this.cellRect) {
      event.preventDefault();
      this.clearSelectedCells();
    } else if (event.key === 'Tab') {
      this.handleTab(event);
    } else if (event.key === 'Escape') {
      this.clearCellSelection();
      this.selectImage(null);
      this.cancelFormatPainter();
    }
  };

  /**
   * Tab moves between table cells (appending a row after the last one), nests list items, indents a paragraph at its
   * start and types a tab stop inside a line. Shift+Tab reverses each of these.
   */
  private handleTab(event: KeyboardEvent) {
    const range = getRangeWithin(this.root);
    if (!range) return;
    const direction = event.shiftKey ? -1 : 1;
    const cell = closestTag(range.startContainer, this.root, CELL_TAGS) as TableCell | null;
    if (cell) {
      event.preventDefault();
      this.moveToSiblingCell(cell, direction);
      return;
    }
    if (closestListItem(range.startContainer, this.root)) {
      event.preventDefault();
      this.exec(target => (changeListIndent(this.root, target, direction) ? undefined : null));
      return;
    }
    const block = closestTextBlock(range.startContainer, this.root);
    if (!block || block.tagName === 'PRE') return;
    event.preventDefault();
    // Word behaviour: Tab at the start of a paragraph indents it, inside a line it types a tab stop.
    if (direction > 0 && range.collapsed && !isCaretAtBlockStart(block, range)) {
      this.insertText('\t');
      return;
    }
    this.exec(target => (changeIndent(this.root, target, direction) ? undefined : null));
  }

  /** Moves the caret to the next or previous cell; moving past the last cell appends a row as an undo step. */
  private moveToSiblingCell(cell: TableCell, direction: 1 | -1) {
    const lastCell = cell.closest('table')?.querySelector('tr:last-child > :last-child');
    const staysInsideTable = direction > 0 && !lastCell?.isSameNode(cell);
    if (staysInsideTable) {
      const block = siblingCell(cell, direction)?.querySelector<HTMLElement>(TEXT_BLOCK_QUERY);
      if (block) {
        this.expectInternalSelection();
        placeCaretAtEnd(block);
      }
      return;
    }
    this.exec(() => {
      const block = siblingCell(cell, direction)?.querySelector<HTMLElement>(TEXT_BLOCK_QUERY);
      return block ? endCaret(block) : null;
    });
  }

  /** Runs the command bound to a keyboard shortcut. */
  private runKeyCommand(command: KeyCommand) {
    const heading = /^heading([1-6])$/.exec(command)?.[1];
    if (heading) {
      this.setBlockType(`H${heading}` as HeadingTag);
      return;
    }
    const actions: Partial<Record<KeyCommand, () => void>> = {
      undo: () => this.undo(),
      redo: () => this.redo(),
      highlight: () => this.setHighlight(this.getState().highlight ? null : DEFAULT_HIGHLIGHT_COLOR),
      paragraph: () => this.setBlockType('P'),
      alignLeft: () => this.setTextAlign('left'),
      alignCenter: () => this.setTextAlign('center'),
      alignRight: () => this.setTextAlign('right'),
      alignJustify: () => this.setTextAlign('justify'),
      bulletList: () => this.toggleList('bulletList'),
      orderedList: () => this.toggleList('orderedList'),
      taskList: () => this.toggleList('taskList'),
      blockquote: () => this.toggleBlockquote(),
      codeBlock: () => this.toggleCodeBlock(),
      pageBreak: () => this.insertPageBreak()
    };
    const action = actions[command];
    if (action) action();
    else this.toggleMark(command as MarkName);
  }

  /** Pastes sanitised content; lone images go to the host for upload and a URL over a selection becomes a link. */
  private onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    if (!this.editable) return;
    const content = readTransfer(event.clipboardData);
    const images = imageFiles(content);
    if (images.length && !content.html && !content.text) {
      this.options.onImageFiles(images);
      return;
    }
    const url = singleUrl(content);
    const range = this.currentRange();
    if (url && range && !range.collapsed && !closestTag(range.startContainer, this.root, 'PRE')) {
      this.setLink(url, null);
      return;
    }
    this.insertTransfer(content);
  };

  /** Inserts clipboard content at the selection; inside a code block only its plain text is used. */
  private insertTransfer(content: TransferContent) {
    const range = this.currentRange();
    const inCode = range ? closestTextBlock(range.startContainer, this.root)?.tagName === 'PRE' : false;
    const fragment = inCode ? textToFragment(content.text) : transferToFragment(content);
    if (!fragment || this.exceedsLimit(fragment.textContent?.length ?? 0)) return;
    this.exec(target => {
      const start = this.collapsedAfterDelete(target);
      const { anchor } = rangeToBookmark(this.root, start);
      const caret = insertFragment(this.root, start, fragment);
      if (!caret || this.trackingAuthor === null) return caret ?? undefined;
      const end = document.createRange();
      end.setStart(caret.node, caret.offset);
      const after = rangeToBookmark(this.root, end).anchor;
      this.markInsertedBetween(anchor, after, 'command');
      return { anchor: after, focus: after };
    });
  }

  /** Puts clean HTML and plain text of the selection on the clipboard. */
  private onCopy = (event: ClipboardEvent) => {
    const range = getRangeWithin(this.root);
    if (!range || range.collapsed || !event.clipboardData) return;
    event.preventDefault();
    writeTransfer(event.clipboardData, this.root, range);
  };

  /** Copies the selection like {@link onCopy} and deletes it as an undo step. */
  private onCut = (event: ClipboardEvent) => {
    const range = getRangeWithin(this.root);
    if (!range || range.collapsed || !event.clipboardData) return;
    event.preventDefault();
    writeTransfer(event.clipboardData, this.root, range);
    this.deleteSelection();
  };

  /** Starts dragging the selection with clean clipboard data and remembers it for a move on drop. */
  private onDragStart = (event: DragEvent) => {
    const range = getRangeWithin(this.root);
    if (!range || range.collapsed || !event.dataTransfer) return;
    this.dragRange = range.cloneRange();
    writeTransfer(event.dataTransfer, this.root, range);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  /** Forgets the dragged selection once the drag ends anywhere. */
  private onDragEnd = () => {
    this.dragRange = null;
  };

  /** Allows dropping into an editable document. */
  private onDragOver = (event: DragEvent) => {
    if (this.editable) event.preventDefault();
  };

  /**
   * Inserts dropped content at the pointer. A selection dragged within the document is moved (copied with Ctrl) in a
   * single undo step; dropped image files go to the host for upload.
   */
  private onDrop = (event: DragEvent) => {
    event.preventDefault();
    const source = this.dragRange;
    this.dragRange = null;
    if (!this.editable) return;
    const point = rangeFromPoint(event.clientX, event.clientY);
    if (!point || !this.root.contains(point.startContainer)) return;
    const content = readTransfer(event.dataTransfer);
    const images = imageFiles(content);
    this.expectInternalSelection();
    this.root.focus({ preventScroll: true });
    if (images.length) {
      selectRange(point);
      this.options.onImageFiles(images);
      return;
    }
    const fragment = transferToFragment(content);
    if (!fragment) return;
    const before = this.snapshot();
    let insertAt = rangeToBookmark(this.root, point).anchor;
    if (source && !source.collapsed && !event.ctrlKey && this.root.contains(source.startContainer)) {
      const moved = rangeToBookmark(this.root, source);
      if (insertAt > moved.anchor && insertAt < moved.focus) return;
      if (this.trackingAuthor !== null) {
        // The moved text stays visible as a deletion, so positions after it do not shift.
        markDeleted(this.root, source, this.nextChange('command'));
        normalizeContainer(this.root, true);
      } else {
        deleteRange(this.root, source);
        normalizeContainer(this.root, true);
        if (insertAt >= moved.focus) insertAt -= moved.focus - moved.anchor;
      }
    }
    const target = bookmarkToRange(this.root, { anchor: insertAt, focus: insertAt });
    const caret = insertFragment(this.root, target, fragment);
    if (caret && this.trackingAuthor !== null) {
      const end = document.createRange();
      end.setStart(caret.node, caret.offset);
      this.markInsertedBetween(insertAt, rangeToBookmark(this.root, end).anchor, 'command');
    }
    this.history.record(() => before, 'command');
    this.finishEdit(caret ?? { anchor: insertAt, focus: insertAt });
  };

  /** Selects a clicked image, clears a previous cell selection and remembers the cell where a drag may start. */
  private onMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    this.clearCellSelection();
    if (target.tagName === 'IMG' && this.root.contains(target)) {
      this.selectImage(target as HTMLImageElement);
      const range = document.createRange();
      range.selectNode(target);
      this.expectInternalSelection();
      selectRange(range);
    } else {
      this.selectImage(null);
    }
    this.cellAnchor =
      event.button === PRIMARY_BUTTON ? (closestTag(target, this.root, CELL_TAGS) as TableCell | null) : null;
  };

  /** Extends a rectangular cell selection while the mouse is dragged across table cells. */
  private onMouseMove = (event: MouseEvent) => {
    if (!this.cellAnchor || !(event.buttons & PRIMARY_BUTTON_MASK)) return;
    const cell = closestTag(event.target as Node, this.root, CELL_TAGS) as TableCell | null;
    if (!cell || cell === this.cellAnchor) return;
    const rect = rectBetween(this.cellAnchor, cell);
    if (!rect) return;
    this.cellRect = rect;
    markSelectedCells(this.root, cellsInRect(rect));
    this.root.classList.add('has-cell-selection');
    this.emit('selection', undefined);
  };

  /** Toggles task list checkboxes as undo steps and opens links on Ctrl/Cmd+click. */
  private onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const item = target.closest('li[data-type="taskItem"]');
      if (!this.editable || !item || !this.root.contains(item)) {
        event.preventDefault();
        return;
      }
      // The browser has already toggled the box; mirror it into the document.
      const checked = target.checked;
      this.mutate(() => {
        item.setAttribute('data-checked', String(checked));
        target.toggleAttribute('checked', checked);
      });
      return;
    }
    const link = target.closest('a');
    if (link && this.root.contains(link) && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }
  };

  /** Deletes a selection before an IME replaces it and pauses layout work while composing. */
  private onCompositionStart = () => {
    const range = getRangeWithin(this.root);
    if (range && !range.collapsed) this.deleteSelection();
    else this.history.record(() => this.snapshot(), 'typing');
    this.composingText = true;
    this.emit('composition', true);
  };

  /** Repairs the structure once the IME has committed its text. */
  private onCompositionEnd = (event: CompositionEvent) => {
    this.composingText = false;
    this.repairStructure();
    const range = getRangeWithin(this.root);
    if (this.trackingAuthor !== null && event.data && range?.collapsed) {
      const { anchor } = rangeToBookmark(this.root, range);
      this.markInsertedBetween(anchor - event.data.length, anchor, 'typing');
      restoreBookmark(this.root, { anchor, focus: anchor });
    }
    this.refresh();
    this.emit('composition', false);
  };

  // -------------------------------------------------------------------------------------------------------------
  // History

  /** Reverts the last undo step. */
  undo(): void {
    if (!this.editable) return;
    const previous = this.history.undo(this.snapshot());
    if (previous) this.restoreSnapshot(previous);
  }

  /** Re-applies the last reverted undo step. */
  redo(): void {
    if (!this.editable) return;
    const next = this.history.redo(this.snapshot());
    if (next) this.restoreSnapshot(next);
  }

  /** Puts a history snapshot back into the document and restores its selection. */
  private restoreSnapshot(snapshot: Snapshot) {
    this.root.innerHTML = snapshot.blocks.join('');
    this.pending = null;
    this.selectImage(null);
    this.clearCellSelection();
    this.expectInternalSelection();
    this.root.focus({ preventScroll: true });
    if (snapshot.bookmark) restoreBookmark(this.root, snapshot.bookmark);
    this.refresh();
    scrollSelectionIntoView(this.root);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Text and inline formatting

  /** Inserts plain text at the selection, replacing selected content and applying pending formatting. */
  insertText(text: string): void {
    if (this.exceedsLimit(text.length)) return;
    const pending = this.pending;
    this.exec(range => {
      const target = this.collapsedAfterDelete(range, 'typing');
      const { anchor } = rangeToBookmark(this.root, target);
      if (pending && closestTextBlock(target.startContainer, this.root)) {
        insertFormattedText(this.root, target, text, pending);
      } else {
        const caret = insertTextAtCaret(this.root, target, text);
        if (this.trackingAuthor === null) return caret;
      }
      this.markInsertedBetween(anchor, anchor + text.length, 'typing');
      return { anchor: anchor + text.length, focus: anchor + text.length };
    }, 'typing');
    this.pending = null;
  }

  /** Text of the current block before a collapsed caret, or `null` when the selection is not a caret in text. */
  getTextBeforeCaret(): string | null {
    const range = this.currentRange();
    if (!range?.collapsed) return null;
    const block = closestTextBlock(range.startContainer, this.root);
    if (!block || block.tagName === 'PRE') return null;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString();
  }

  /**
   * Deletes the characters right before a collapsed caret, as one undo step; used by typed triggers such as the
   * `/` command menu to remove what was typed.
   */
  deleteBeforeCaret(count: number): void {
    if (count <= 0) return;
    this.exec(range => {
      if (!range.collapsed) return null;
      const { anchor } = rangeToBookmark(this.root, range);
      const start = Math.max(0, anchor - count);
      deleteRange(this.root, bookmarkToRange(this.root, { anchor: start, focus: anchor }));
      return { anchor: start, focus: start };
    });
  }

  /** Formatting at the start of a range, or `null` when the text there is unformatted. */
  private captureFormat(range: Range): PendingFormat | null {
    const node = range.startContainer;
    const marks = Object.fromEntries(Object.entries(readMarks(this.root, node)).filter(([, active]) => active));
    const styles = Object.fromEntries(
      CARRIED_STYLES.map(name => [name, readStyle(this.root, node, name)]).filter(([, value]) => value)
    );
    const highlight = readHighlight(this.root, node);
    if (!Object.keys(marks).length && !Object.keys(styles).length && !highlight) return null;
    return { marks, styles, ...(highlight ? { highlight } : {}) };
  }

  /**
   * Enter splits the block (or leaves an empty list item or quote), Shift+Enter inserts a line break. An empty new
   * line keeps the formatting of the text before it, as in office editors.
   */
  private splitLine(lineBreak: boolean) {
    const range = this.currentRange();
    const format = range ? (this.pending ?? this.captureFormat(range)) : null;
    this.exec(target => {
      const collapsed = this.collapsedAfterDelete(target);
      return (lineBreak ? insertLineBreak : splitAtCaret)(this.root, collapsed);
    });
    const block = closestTextBlock(getRangeWithin(this.root)?.startContainer, this.root);
    if (format && block && isEmptyTextBlock(block)) this.pending = format;
  }

  /** Toggles bold, italic and the other marks; at a collapsed caret it applies to the next typed text. */
  toggleMark(mark: MarkName): void {
    const range = this.currentRange();
    if (!range || !this.editable) return;
    if (range.collapsed) {
      const active = this.getState()[mark];
      this.setPending({ marks: { ...this.pending?.marks, [mark]: !active } });
      return;
    }
    this.exec(target => {
      toggleMark(this.root, target, mark);
    });
  }

  /** Sets or removes (`null`) text colour, font family or font size; at a collapsed caret for the next text. */
  setTextStyle(name: StyleName, value: string | null): void {
    const range = this.currentRange();
    if (!range || !this.editable) return;
    if (range.collapsed) {
      this.setPending({ styles: { ...this.pending?.styles, [name]: value } });
      return;
    }
    this.exec(target => {
      setTextStyle(this.root, target, name, value);
    });
  }

  /** Sets or removes (`null`) the highlight colour; at a collapsed caret for the next text. */
  setHighlight(color: string | null): void {
    const range = this.currentRange();
    if (!range || !this.editable) return;
    if (range.collapsed) {
      this.setPending({ highlight: color });
      return;
    }
    this.exec(target => {
      setHighlight(this.root, target, color);
    });
  }

  /** Merges a formatting change into the pending format and keeps focus in the document. */
  private setPending(change: Partial<PendingFormat>) {
    this.pending = { marks: {}, styles: {}, ...this.pending, ...change };
    this.focus();
    this.emit('selection', undefined);
  }

  /** Changes the letter case of the selected text. */
  changeTextCase(mode: TextCase): void {
    this.exec(range => (applyTextCase(this.root, range, mode) ? undefined : null));
  }

  /** Converts Uzbek text between the Latin and Cyrillic alphabet: the selection, or the whole document at a caret. */
  transliterate(direction: TransliterationDirection): void {
    this.exec(range => {
      const target = range.cloneRange();
      if (target.collapsed) target.selectNodeContents(this.root);
      const changed = transformSelectedText(this.root, target, (text, previous) =>
        transliterate(text, direction, previous)
      );
      return changed ? undefined : null;
    });
  }

  /**
   * Rewrites the amount that is selected, or the number right before the caret, with `format`; used to add an amount
   * in words. Nothing changes when the text there is not an amount.
   *
   * @returns whether an amount was found and rewritten.
   */
  replaceAmount(format: (value: number) => string): boolean {
    const range = this.currentRange();
    if (!range || !this.editable) return false;
    const target = range.cloneRange();
    if (target.collapsed) {
      const node = target.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return false;
      const before = (node as Text).data.slice(0, target.startOffset);
      const match = /-?\d(?:[\d   .,]*\d)?$/.exec(before);
      if (!match) return false;
      target.setStart(node, match.index);
    }
    const value = parseAmount(target.toString());
    if (value === null) return false;
    const text = format(value);
    return this.exec(() => insertTextAtCaret(this.root, this.collapsedAfterDelete(target), text));
  }

  /** Stores the format the painter carries and shows the painting cursor while it does. */
  private setPainterFormat(format: CopiedFormat | null) {
    this.painterFormat = format;
    this.root.classList.toggle('is-format-painter', format !== null);
    this.emit('selection', undefined);
  }

  /**
   * Picks up the character and paragraph formatting at the selection. The next selection made with the mouse, or a
   * click inside a paragraph, receives it; {@link cancelFormatPainter} and Escape drop it again.
   */
  copyFormat(): void {
    const range = this.currentRange();
    const block = range ? closestTextBlock(range.startContainer, this.root) : null;
    if (!range || !block || !this.editable) return;
    const node = range.startContainer;
    this.setPainterFormat({
      marks: readMarks(this.root, node),
      styles: {
        color: readStyle(this.root, node, 'color'),
        fontFamily: readStyle(this.root, node, 'fontFamily'),
        fontSize: readStyle(this.root, node, 'fontSize')
      },
      highlight: readHighlight(this.root, node),
      tag: /^H[1-6]$/.test(block.tagName) ? (block.tagName as HeadingTag) : 'P',
      align: (block.style.textAlign || 'left') as TextAlign,
      lineHeight: block.style.lineHeight,
      indent: Number.parseInt(block.dataset.indent ?? '', 10) || 0
    });
  }

  /** Drops the copied format without painting it. */
  cancelFormatPainter(): void {
    if (this.painterFormat) this.setPainterFormat(null);
  }

  /** Paints the copied format onto the selection, or onto the whole paragraph at a collapsed caret. */
  paintFormat(): void {
    const format = this.painterFormat;
    const range = this.currentRange();
    if (!format || !range) return;
    if (range.collapsed) {
      const block = closestTextBlock(range.startContainer, this.root);
      if (!block) return;
      const whole = document.createRange();
      whole.selectNodeContents(block);
      this.expectInternalSelection();
      selectRange(whole);
    }
    this.setPainterFormat(null);
    this.exec(target => {
      // Every step rebuilds the range from the text positions: merging and splitting marks invalidates a live range,
      // while the painted text keeps its offsets, because none of these commands changes the text itself.
      const bookmark = rangeToBookmark(this.root, target);
      const painted = () => bookmarkToRange(this.root, bookmark);
      clearMarks(this.root, painted());
      for (const [mark, active] of Object.entries(format.marks) as Array<[MarkName, boolean]>) {
        if (active) toggleMark(this.root, painted(), mark);
      }
      for (const [name, value] of Object.entries(format.styles) as Array<[StyleName, string]>) {
        if (value) setTextStyle(this.root, painted(), name, value);
      }
      if (format.highlight) setHighlight(this.root, painted(), format.highlight);
      setBlockType(this.root, painted(), format.tag);
      setTextAlign(this.root, painted(), format.align);
      setLineHeight(this.root, painted(), format.lineHeight || null);
      for (const block of textBlocksInRange(this.root, painted())) setIndent(block, format.indent);
      return bookmark;
    });
  }

  /** Removes marks from the selection and turns its blocks into plain paragraphs outside lists and quotes. */
  clearFormatting(): void {
    this.exec(target => {
      const blocks = textBlocksInRange(this.root, target);
      if (!target.collapsed) clearMarks(this.root, target);
      for (const block of blocks) {
        if (!block.isConnected) continue;
        liftOutOfLists(this.root, block);
        const quote = closestTag(block, this.root, 'BLOCKQUOTE');
        if (quote) unwrap(quote);
        block.removeAttribute('style');
        block.removeAttribute('data-indent');
        const blockRange = document.createRange();
        blockRange.selectNodeContents(block);
        setBlockType(this.root, blockRange, 'P');
      }
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Blocks and paragraphs

  /** Turns the selected blocks into paragraphs or headings. */
  setBlockType(tag: 'P' | HeadingTag): void {
    this.exec(target => {
      setBlockType(this.root, target, tag);
    });
  }

  /** Wraps the selected blocks in a quote, or unwraps them when they are all quoted already. */
  toggleBlockquote(): void {
    this.exec(target => {
      toggleBlockquote(this.root, target);
    });
  }

  /** Turns the selected blocks into code blocks, or back into paragraphs. */
  toggleCodeBlock(): void {
    this.exec(target => {
      toggleCodeBlock(this.root, target);
    });
  }

  /** Aligns the selected paragraphs. */
  setTextAlign(align: TextAlign): void {
    this.exec(target => {
      setTextAlign(this.root, target, align);
    });
  }

  /** Sets or removes (`null`) the line spacing of the selected paragraphs. */
  setLineHeight(lineHeight: string | null): void {
    this.exec(target => {
      setLineHeight(this.root, target, lineHeight);
    });
  }

  /** Sets exact indents on the selected paragraphs, in pixels; sides left out keep their value. */
  setParagraphIndents(patch: Partial<ParagraphIndents>): void {
    this.exec(target => {
      setParagraphIndents(this.root, target, patch);
    });
  }

  /** Sets the space before or after the selected paragraphs, in points; `null` restores the document default. */
  setParagraphSpacing(side: SpacingSide, points: number | null): void {
    this.exec(target => {
      setParagraphSpacing(this.root, target, side, points);
    });
  }

  /** Sets the writing direction of the selected paragraphs. */
  setTextDirection(direction: TextDirection): void {
    this.exec(target => {
      setTextDirection(this.root, target, direction);
    });
  }

  /** Turns the selected blocks into a list of the given kind, converts another list kind, or lifts them out. */
  toggleList(kind: ListKind): void {
    this.exec(target => {
      toggleList(this.root, target, kind);
    });
  }

  /**
   * Switches the numbered list at the selection, together with its nested lists, between simple (1, 2, 3) and legal
   * (1.1, 1.2) numbering. The setting lives on the outermost numbered list.
   */
  setListNumbering(style: 'default' | 'legal'): void {
    this.exec(range => {
      let outer: HTMLElement | null = null;
      for (
        let node = closestListItem(range.startContainer, this.root)?.parentElement ?? null;
        node && node !== this.root;
        node = node.parentElement
      ) {
        if (node.tagName === 'OL') outer = node;
      }
      if (!outer || (outer.getAttribute('data-numbering') === 'legal') === (style === 'legal')) return null;
      if (style === 'legal') outer.setAttribute('data-numbering', 'legal');
      else outer.removeAttribute('data-numbering');
      return undefined;
    });
  }

  /** List items are nested or lifted; other paragraphs get indentation steps. */
  indent(direction: 1 | -1): void {
    this.exec(target => {
      const inList = closestListItem(target.startContainer, this.root) !== null;
      const changed = inList
        ? changeListIndent(this.root, target, direction)
        : changeIndent(this.root, target, direction);
      return changed ? undefined : null;
    });
  }

  /**
   * Inserts a block element at the caret and places the caret after it, or inside it when `caretInside` finds a
   * target (e.g. the first cell of a new table).
   */
  private insertBlock(element: HTMLElement, caretInside?: (element: HTMLElement) => HTMLElement | null) {
    this.exec(range => {
      const next = insertBlockAtCaret(this.root, this.collapsedAfterDelete(range), element);
      const inside = caretInside?.(element);
      return startCaret(inside ?? next);
    });
  }

  /** Inserts a horizontal rule. */
  insertHorizontalRule(): void {
    this.insertBlock(createElement('hr'));
  }

  /** Inserts a manual page break. */
  insertPageBreak(): void {
    this.insertBlock(createElement('div', { 'data-type': 'page-break', class: 'doc-page-break' }));
  }

  /**
   * Inserts sanitised HTML at the selection as one undo step. By default it flows into the current line the way pasting
   * does; with `asBlocks` the content starts on a line of its own after a non-empty paragraph, as prepared fragments
   * such as signature blocks and document templates should.
   */
  insertContent(html: string, { asBlocks = false } = {}): void {
    if (!asBlocks) {
      this.insertTransfer({ html, text: '', files: [] });
      return;
    }
    const fragment = sanitizeHtml(html);
    if (this.exceedsLimit(fragment.textContent?.length ?? 0)) return;
    this.exec(range => {
      const nodes = Array.from(fragment.childNodes);
      const last = nodes.at(-1);
      if (!last) return null;
      const target = this.collapsedAfterDelete(range);
      const block = closestTextBlock(target.startContainer, this.root);
      if (!block) {
        this.root.append(...nodes);
      } else if (isEmptyTextBlock(block)) {
        block.before(...nodes);
        // The empty line only stays when nothing follows, so the caret has a place after the content.
        if (block.nextElementSibling) block.remove();
      } else if (isCaretAtBlockStart(block, target)) {
        block.before(...nodes);
      } else if (isCaretAtBlockEnd(block, target)) {
        block.after(...nodes);
      } else {
        splitBlock(block, target.startContainer, target.startOffset);
        block.after(...nodes);
      }
      if (isTextBlock(last) && last.tagName !== 'PRE') return endCaret(last);
      const next = last.nextSibling;
      if (isTextBlock(next)) return startCaret(next);
      const paragraph = createParagraph();
      last.after(paragraph);
      return startCaret(paragraph);
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Outline

  /** Headings written directly in the document, in document order, down to the given level. */
  getOutline(depth?: number): OutlineHeading[] {
    return readOutline(this.root, depth);
  }

  /** Whether the document has a table of contents. */
  get hasTableOfContents(): boolean {
    return this.root.querySelector(TABLE_OF_CONTENTS_SELECTOR) !== null;
  }

  /**
   * Writes a table of contents: an existing one is replaced in place, keeping the selection, otherwise the table is
   * inserted at the selection. Without `addToHistory` a replacement joins the previous undo step, e.g. when page
   * numbers are corrected right after inserting the table.
   */
  setTableOfContents(html: string, { addToHistory = true } = {}): void {
    const current = this.root.querySelector<HTMLElement>(TABLE_OF_CONTENTS_SELECTOR);
    if (!current) {
      this.insertContent(html, { asBlocks: true });
      return;
    }
    const table = sanitizeHtml(html).firstElementChild;
    if (!table || !this.editable) return;
    if (addToHistory) {
      this.mutate(() => current.replaceWith(table));
      return;
    }
    current.replaceWith(table);
    this.refresh();
  }

  /** Scrolls a heading to the top of the view and puts the caret at its start. */
  goToHeading(heading: HTMLElement): void {
    if (!this.root.contains(heading)) return;
    heading.scrollIntoView({ block: 'start' });
    const range = document.createRange();
    range.setStart(heading, 0);
    range.collapse(true);
    this.root.focus({ preventScroll: true });
    selectRange(range);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Footnotes

  /**
   * Inserts a footnote reference with its text at the selection, replacing selected content, as one undo step.
   * @returns the new reference, or `null` when nothing could be inserted (for example in a code block).
   */
  insertFootnote(text: string): HTMLElement | null {
    let inserted: HTMLElement | null = null;
    this.exec(range => {
      const reference = createFootnote(text);
      const caret = insertInlineAtCaret(this.root, this.collapsedAfterDelete(range), reference);
      if (caret) inserted = reference;
      return caret;
    });
    return inserted;
  }

  /** Changes the text of a footnote as one undo step; unchanged text records nothing. */
  setFootnoteText(reference: HTMLElement, text: string): void {
    const value = text.slice(0, MAX_FOOTNOTE_LENGTH);
    if (!this.root.contains(reference) || reference.getAttribute(FOOTNOTE_ATTRIBUTE) === value) return;
    this.mutate(() => reference.setAttribute(FOOTNOTE_ATTRIBUTE, value));
  }

  /** Removes a footnote reference together with its note, as one undo step. */
  removeFootnote(reference: HTMLElement): void {
    if (!this.root.contains(reference)) return;
    this.mutate(() => {
      const block = closestTextBlock(reference, this.root);
      reference.remove();
      if (block) {
        mergeAdjacentMarks(block);
        syncTrailingBreak(block);
      }
    });
  }

  /** Footnote references with their texts, in document order; the first one is number 1. */
  getFootnotes(): Array<{ element: HTMLElement; text: string }> {
    return Array.from(this.root.querySelectorAll<HTMLElement>(FOOTNOTE_SELECTOR)).map(element => ({
      element,
      text: element.getAttribute(FOOTNOTE_ATTRIBUTE) ?? ''
    }));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Comments

  /**
   * Anchors a new comment to the selected text as one undo step.
   * @returns whether text was selected and the id is valid.
   */
  addComment(id: string): boolean {
    if (!COMMENT_ID.test(id)) return false;
    return this.exec(range => (addCommentAnchor(this.root, range, id) ? undefined : null));
  }

  /** Removes the anchors of a comment, keeping their text, as one undo step. */
  removeComment(id: string): void {
    const anchors = this.commentAnchors(id);
    if (!anchors.length) return;
    this.mutate(() => {
      for (const anchor of anchors) {
        const block = closestTextBlock(anchor, this.root);
        unwrap(anchor);
        if (block) mergeAdjacentMarks(block);
      }
    });
  }

  /** Ids of the comments anchored in the document, each once, in document order. */
  getCommentIds(): string[] {
    const anchors = Array.from(this.root.querySelectorAll<HTMLElement>(COMMENT_SELECTOR));
    return [...new Set(anchors.map(anchor => anchor.getAttribute(COMMENT_ATTRIBUTE) ?? ''))].filter(Boolean);
  }

  /** Ids of the comments anchored around the caret or the start of the selection, innermost first. */
  getCommentsAtSelection(): string[] {
    const range = this.currentRange();
    if (!range) return [];
    const ids: string[] = [];
    let node: Node | null = range.startContainer;
    // A caret right after an anchor's last character still belongs to it.
    if (isText(node) && range.startOffset === 0 && range.collapsed) node = node.previousSibling ?? node;
    while (node && node !== this.root) {
      if (node instanceof HTMLElement && node.matches(COMMENT_SELECTOR)) {
        ids.push(node.getAttribute(COMMENT_ATTRIBUTE) ?? '');
      }
      node = node.parentNode;
    }
    return ids;
  }

  /** Selects the text of a comment and scrolls it into view. */
  selectComment(id: string): void {
    const anchors = this.commentAnchors(id);
    const first = anchors[0];
    const last = anchors.at(-1);
    if (!first || !last) return;
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    first.scrollIntoView({ block: 'center' });
    this.root.focus({ preventScroll: true });
    selectRange(range);
  }

  /**
   * Shows resolved comments without their highlight and marks the active one. Only classes change, which saved HTML
   * drops, so this is neither an edit nor an undo step.
   */
  decorateComments(resolved: ReadonlySet<string>, active: string | null): void {
    for (const anchor of Array.from(this.root.querySelectorAll<HTMLElement>(COMMENT_SELECTOR))) {
      const id = anchor.getAttribute(COMMENT_ATTRIBUTE) ?? '';
      anchor.classList.toggle('is-resolved', resolved.has(id));
      anchor.classList.toggle('is-active', id === active);
      if (!anchor.classList.length) anchor.removeAttribute('class');
    }
  }

  /** Anchor elements of one comment, in document order. */
  private commentAnchors(id: string): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>(COMMENT_SELECTOR)).filter(
      anchor => anchor.getAttribute(COMMENT_ATTRIBUTE) === id
    );
  }

  // -------------------------------------------------------------------------------------------------------------
  // Template variables

  /** Inserts the chip of a template variable at the selection; invalid names are ignored. */
  insertVariable(name: string): void {
    if (!VARIABLE_NAME.test(name)) return;
    this.exec(range => insertInlineAtCaret(this.root, this.collapsedAfterDelete(range), createVariable(name)));
  }

  /** Names of the template variables used in the document, each once, in document order. */
  getVariables(): string[] {
    const chips = Array.from(this.root.querySelectorAll<HTMLElement>(VARIABLE_SELECTOR));
    return [...new Set(chips.map(chip => chip.getAttribute(VARIABLE_ATTRIBUTE) ?? ''))].filter(Boolean);
  }

  /** Re-reads the labels of every variable chip, e.g. after the host's variable list or locale changed. */
  refreshVariables(): void {
    this.updateVariableLabels();
  }

  /** Writes the host's label into every chip that shows a different one; a chip of an unknown name shows `{{name}}`. */
  private updateVariableLabels() {
    for (const chip of Array.from(this.root.querySelectorAll<HTMLElement>(VARIABLE_SELECTOR))) {
      const name = chip.getAttribute(VARIABLE_ATTRIBUTE) ?? '';
      const label = this.options.variableLabel?.(name);
      const text = label ?? `{{${name}}}`;
      if (chip.getAttribute(VARIABLE_LABEL_ATTRIBUTE) !== text) chip.setAttribute(VARIABLE_LABEL_ATTRIBUTE, text);
      chip.classList.toggle('is-unknown', label === undefined);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Links

  /** Link that contains the start of the selection. */
  getActiveLink(): HTMLAnchorElement | null {
    const range = this.currentRange();
    return range ? linkAncestor(range.startContainer, this.root) : null;
  }

  /**
   * Links the selection, edits the link under a collapsed caret, or inserts a new linked text. Unsafe URLs are ignored.
   *
   * @param href Link address.
   * @param target `_blank` to open in a new tab, `null` for the same tab.
   * @param text Label inserted when nothing is selected; defaults to the URL.
   */
  setLink(href: string, target: string | null, text?: string): void {
    const url = sanitizeUrl(href);
    if (!url) return;
    this.exec(range => {
      const existing = linkAncestor(range.startContainer, this.root);
      if (range.collapsed && existing) range.selectNodeContents(existing);
      if (!range.collapsed) {
        setLink(this.root, range, url, target);
        return undefined;
      }
      const label = text || url;
      const caret = insertTextAtCaret(this.root, range, label);
      const linkRange = document.createRange();
      linkRange.setStart(caret.node, caret.offset - label.length);
      linkRange.setEnd(caret.node, caret.offset);
      setLink(this.root, linkRange, url, target);
      return { node: linkRange.endContainer, offset: linkRange.endOffset };
    });
  }

  /** Removes links from the selection, or the whole link under a collapsed caret. */
  unsetLink(): void {
    this.exec(range => {
      const existing = linkAncestor(range.startContainer, this.root);
      if (range.collapsed && existing) range.selectNodeContents(existing);
      unsetLink(this.root, range);
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Images

  /** Inserts a centred image at the caret; unsafe sources are ignored. */
  insertImage(src: string, alt = ''): void {
    const url = sanitizeUrl(src, true);
    if (url) this.insertBlock(createElement('img', { src: url, alt, 'data-align': 'center' }));
  }

  /** Selects an image for the resize handles and image menu, or clears the selection with `null`. */
  selectImage(image: HTMLImageElement | null): void {
    if (this.selectedImageElement === image) return;
    this.selectedImageElement = image;
    this.emit('selection', undefined);
  }

  /** Changes image attributes as an undo step. */
  updateImage(image: HTMLImageElement, attributes: ImageAttributes): void {
    this.mutate(() => {
      for (const [name, value] of Object.entries(attributes)) {
        const attribute = name === 'align' ? 'data-align' : name;
        if (value === null || value === undefined || value === '') image.removeAttribute(attribute);
        else image.setAttribute(attribute, String(value));
      }
    });
  }

  /** Deletes an image and places the caret in the neighbouring text. */
  removeImage(image: HTMLImageElement): void {
    this.selectImage(null);
    this.exec(() => {
      const next = image.nextElementSibling;
      const previous = image.previousElementSibling;
      image.remove();
      if (isTextBlock(next)) return startCaret(next);
      return isTextBlock(previous) ? endCaret(previous) : undefined;
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Tables

  /** Table cell that contains the start of the selection. */
  getActiveCell(): TableCell | null {
    const range = this.currentRange();
    return range ? (closestTag(range.startContainer, this.root, CELL_TAGS) as TableCell | null) : null;
  }

  /** Whether the selected cells form a rectangle that can be merged. */
  canMergeCells(): boolean {
    return canMergeRect(this.cellRect);
  }

  /** Whether the active cell spans several rows or columns. */
  canSplitCell(): boolean {
    return canSplitCell(this.getActiveCell());
  }

  /** Sets a column width in pixels as an undo step, e.g. after dragging a column border. */
  resizeColumn(table: HTMLTableElement, index: number, width: number): void {
    this.mutate(() => setColumnWidth(table, index, width));
  }

  /** Inserts a table and places the caret in its first cell. */
  insertTable(rows: number, cols: number, withHeaderRow: boolean): void {
    this.insertBlock(createTable(rows, cols, withHeaderRow), table => table.querySelector<HTMLElement>('p'));
  }

  /** Runs a table operation on the active cell or the selected cells. */
  tableCommand(command: TableCommand): void {
    const cell = this.getActiveCell() ?? (this.cellRect ? cellsInRect(this.cellRect)[0] : null);
    const table = cell?.closest('table');
    if (!cell || !table) return;
    const rect = this.cellRect;
    this.clearCellSelection();
    this.exec(() => {
      switch (command) {
        case 'addRowBefore':
        case 'addRowAfter':
          addRow(cell, command === 'addRowBefore' ? 'before' : 'after');
          return undefined;
        case 'addColumnBefore':
        case 'addColumnAfter':
          addColumn(cell, command === 'addColumnBefore' ? 'before' : 'after');
          return undefined;
        case 'deleteRow':
          deleteRow(cell);
          return undefined;
        case 'deleteColumn':
          deleteColumn(cell);
          return undefined;
        case 'mergeCells': {
          const merged = rect ? mergeCells(rect) : null;
          const block = merged?.querySelector<HTMLElement>(TEXT_BLOCK_QUERY);
          return block ? endCaret(block) : null;
        }
        case 'splitCell':
          if (!canSplitCell(cell)) return null;
          splitCell(cell);
          return undefined;
        case 'toggleHeaderRow':
          toggleHeaderRow(table);
          return undefined;
        default: {
          // deleteTable
          const next = table.nextElementSibling;
          table.remove();
          return isTextBlock(next) ? startCaret(next) : undefined;
        }
      }
    });
  }

  /** Ends a rectangular cell selection. */
  private clearCellSelection() {
    if (!this.cellRect) return;
    this.cellRect = null;
    markSelectedCells(this.root, []);
    this.root.classList.remove('has-cell-selection');
    this.emit('selection', undefined);
  }

  /** Empties every selected cell as one undo step. */
  private clearSelectedCells() {
    const rect = this.cellRect;
    if (!rect) return;
    this.mutate(() => {
      for (const cell of cellsInRect(rect)) cell.replaceChildren(createParagraph());
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Find and replace

  /** Replaces the current search match as an undo step. */
  replaceMatch(replacement: string): void {
    this.mutate(() => {
      this.search.replaceCurrent(replacement);
      normalizeContainer(this.root, true);
    });
  }

  /** Replaces every search match as one undo step. */
  replaceAllMatches(replacement: string): void {
    this.mutate(() => {
      this.search.replaceAll(replacement);
      normalizeContainer(this.root, true);
    });
  }
}
