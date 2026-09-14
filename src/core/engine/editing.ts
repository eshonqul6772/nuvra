import { childOf, containerOf, splitBlock } from './blocks';
import {
  ATOM_SELECTOR,
  INLINE_ATOM_SELECTOR,
  TEXT_BLOCK_SELECTOR,
  closestTag,
  closestTextBlock,
  createParagraph,
  createTrailingBreak,
  isAtBlockEnd,
  isAtBlockStart,
  isAtom,
  isElement,
  isEmptyTextBlock,
  isText,
  isTextBlock,
  isTrailingBreak,
  isVisuallyEmpty,
  mergeAdjacentMarks,
  removeEmptyMarks,
  renameElement,
  syncTrailingBreak,
  textBlocksInRange,
  textBlocksWithin
} from './dom';
import { closestListItem, liftListItem, splitListItem } from './lists';
import { listItemBody } from './schema';
import { indexOf } from './selection';

/** A collapsed DOM position returned by edits so the engine can restore the caret. */
export interface Caret {
  /** Container node of the position. */
  node: Node;
  /** Offset inside `node`: a character index for text, a child index for elements. */
  offset: number;
}

/** Table elements that must never be removed as "empty" while cleaning up after a merge. */
const STRUCTURAL_TAGS = new Set(['TD', 'TH', 'TR', 'TBODY', 'TABLE']);
/** Table cell tags; edits never merge content across cells. */
const CELL_TAGS = new Set(['TD', 'TH']);
/** Headings are followed by body text when Enter is pressed at their end. */
const HEADING_TAG = /^H[1-6]$/;

/** Table cell containing `node`, or `null` outside tables. */
const closestCell = (node: Node, root: HTMLElement) => closestTag(node, root, CELL_TAGS);

/** Caret before the first character of a block (or inside it when it has no text). */
export const startCaret = (block: HTMLElement): Caret => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  return first ? { node: first, offset: 0 } : { node: block, offset: 0 };
};

/** Caret after the last character of a block, before its caret placeholder when it has no text. */
export const endCaret = (block: HTMLElement): Caret => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text;
  if (last) return { node: last, offset: last.length };
  const scope = block.tagName === 'PRE' ? (block.querySelector('code') ?? block) : block;
  const trailing = Array.from(scope.childNodes).find(isTrailingBreak);
  return { node: scope, offset: trailing ? indexOf(trailing) : scope.childNodes.length };
};

/** Removes elements left without any content, stopping at tables so their structure survives. */
const pruneEmptyAncestors = (node: Node | null, root: HTMLElement) => {
  let current = node;
  while (
    current &&
    current !== root &&
    isElement(current) &&
    !STRUCTURAL_TAGS.has(current.tagName) &&
    !current.querySelector(`${TEXT_BLOCK_SELECTOR}, ${ATOM_SELECTOR}, table`)
  ) {
    const parent: Node | null = current.parentNode;
    current.remove();
    current = parent;
  }
};

/** Normalises the inline content of a block after an edit. */
const tidy = (block: HTMLElement) => {
  removeEmptyMarks(block);
  mergeAdjacentMarks(block);
  syncTrailingBreak(block);
};

/** Appends the content of `source` to `target`, removes `source`, and returns the caret at the join. */
const mergeBlocks = (target: HTMLElement, source: HTMLElement, root: HTMLElement): Caret => {
  const caret = endCaret(target);
  if (target.tagName === 'PRE' || source.tagName === 'PRE') {
    // Code blocks hold plain text, so only the text of the other block is carried over.
    const text = document.createTextNode(source.textContent ?? '');
    const scope = target.tagName === 'PRE' ? (target.querySelector('code') ?? target) : target;
    const trailing = Array.from(scope.childNodes).find(isTrailingBreak) ?? null;
    scope.insertBefore(text, trailing);
  } else {
    for (const trailing of Array.from(target.childNodes).filter(isTrailingBreak)) trailing.remove();
    target.append(...Array.from(source.childNodes).filter(node => !isTrailingBreak(node)));
  }
  const parent = source.parentNode;
  source.remove();
  pruneEmptyAncestors(parent, root);
  if (target.tagName !== 'PRE') {
    removeEmptyMarks(target);
    syncTrailingBreak(target);
  }
  return caret;
};

/** Deletes the selected content. The caret should be restored to the range start by the caller. */
export const deleteRange = (root: HTMLElement, range: Range): void => {
  if (range.collapsed) return;
  const startCell = closestCell(range.startContainer, root);
  const endCell = closestCell(range.endContainer, root);
  if (startCell !== endCell) {
    // Across table cells only the text is cleared; rows and columns are removed with table commands.
    for (const block of textBlocksInRange(root, range)) {
      const part = document.createRange();
      part.selectNodeContents(block);
      if (block.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (block.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      part.deleteContents();
      tidy(block);
    }
    return;
  }
  const startBlock = closestTextBlock(range.startContainer, root);
  const endBlock = closestTextBlock(range.endContainer, root);
  range.deleteContents();
  if (startBlock?.isConnected && endBlock?.isConnected && startBlock !== endBlock) {
    mergeBlocks(startBlock, endBlock, root);
  }
  if (startBlock?.isConnected) tidy(startBlock);
};

/** Moves a block out of its quote, splitting the quote when blocks follow it. */
const liftFromQuote = (block: HTMLElement) => {
  const quote = block.parentElement;
  if (quote?.tagName !== 'BLOCKQUOTE') return;
  const following: Node[] = [];
  for (let node = block.nextSibling; node; node = node.nextSibling) following.push(node);
  quote.after(block);
  if (following.length) {
    const rest = quote.cloneNode(false) as HTMLElement;
    rest.append(...following);
    block.after(rest);
  }
  if (!quote.childElementCount) quote.remove();
};

/** Text block before `block` in document order, at any nesting level. */
const previousTextBlock = (root: HTMLElement, block: HTMLElement) => {
  const blocks = textBlocksWithin(root);
  return blocks[blocks.indexOf(block) - 1] ?? null;
};

/** Text block after `block` in document order, at any nesting level. */
const nextTextBlock = (root: HTMLElement, block: HTMLElement) => {
  const blocks = textBlocksWithin(root);
  return blocks[blocks.indexOf(block) + 1] ?? null;
};

/**
 * Backspace at the very start of a text block: lifts it out of a list or quote, deletes a preceding atom,
 * moves into a preceding table, or merges it into the previous text block of the same cell.
 * @returns the new caret, or `null` when nothing applies.
 */
export const joinBackward = (root: HTMLElement, block: HTMLElement): Caret | null => {
  const item = closestListItem(block, root);
  if (item && listItemBody(item).firstElementChild === block) {
    liftListItem(root, item);
    return startCaret(block);
  }
  if (block.parentElement?.tagName === 'BLOCKQUOTE' && block.parentElement.firstElementChild === block) {
    liftFromQuote(block);
    return startCaret(block);
  }

  const container = containerOf(block, root);
  const previousSibling = (childOf(container, block) as Element).previousElementSibling;
  if (isAtom(previousSibling)) {
    previousSibling.remove();
    return startCaret(block);
  }
  if (previousSibling?.tagName === 'TABLE') {
    if (isEmptyTextBlock(block) && container.childElementCount > 1) block.remove();
    const lastCell = previousSibling.querySelector('tr:last-child > :last-child');
    const target = lastCell ? Array.from(lastCell.querySelectorAll<HTMLElement>(TEXT_BLOCK_SELECTOR)).at(-1) : null;
    return target ? endCaret(target) : null;
  }

  const previous = previousTextBlock(root, block);
  if (!previous || closestCell(previous, root) !== closestCell(block, root)) return null;
  return mergeBlocks(previous, block, root);
};

/**
 * Delete at the very end of a text block: deletes a following atom or merges the next text block of the same
 * cell into this one.
 * @returns the new caret, or `null` when nothing applies.
 */
export const joinForward = (root: HTMLElement, block: HTMLElement): Caret | null => {
  const container = containerOf(block, root);
  const top = childOf(container, block) as Element;
  const nextSibling = top === block ? block.nextElementSibling : null;
  if (isAtom(nextSibling)) {
    nextSibling.remove();
    return endCaret(block);
  }
  if (nextSibling?.tagName === 'TABLE') return null;

  const next = nextTextBlock(root, block);
  if (!next || closestCell(next, root) !== closestCell(block, root)) return null;
  const nextItem = closestListItem(next, root);
  const caret = mergeBlocks(block, next, root);
  // The rest of a list item that lost its first paragraph moves up into the current item.
  if (nextItem?.isConnected && closestListItem(block, root) !== nextItem) {
    const currentItem = closestListItem(block, root);
    if (currentItem) {
      listItemBody(currentItem).append(...Array.from(listItemBody(nextItem).childNodes));
      nextItem.remove();
    }
  }
  return caret;
};

/** Inserts a newline into a code block, adding the placeholder a trailing newline needs to be visible. */
const insertNewline = (block: HTMLElement, range: Range): Caret => {
  const caret = insertTextAtCaret(block, range, '\n');
  const code = block.querySelector('code') ?? block;
  if ((block.textContent ?? '').endsWith('\n') && !Array.from(code.childNodes).some(isTrailingBreak)) {
    code.append(createTrailingBreak());
  }
  return caret;
};

/**
 * Enter at a collapsed range: a newline in code blocks, leaving an empty list item or quote, or splitting the
 * block (and its list item). A new line after a heading becomes a paragraph.
 */
export const splitAtCaret = (root: HTMLElement, range: Range): Caret | null => {
  const block = closestTextBlock(range.startContainer, root);
  if (!block) return null;
  if (block.tagName === 'PRE') return insertNewline(block, range);

  const item = closestListItem(block, root);
  if (item && isEmptyTextBlock(block) && listItemBody(item).childElementCount === 1) {
    liftListItem(root, item);
    return startCaret(block);
  }
  if (block.parentElement?.tagName === 'BLOCKQUOTE' && isEmptyTextBlock(block)) {
    liftFromQuote(block);
    return startCaret(block);
  }

  const atEnd = isAtBlockEnd(block, range.startContainer, range.startOffset);
  let right = splitBlock(block, range.startContainer, range.startOffset);
  if (atEnd && HEADING_TAG.test(block.tagName)) right = renameElement(right, 'p');
  if (item && block.parentElement === listItemBody(item)) splitListItem(item, right);
  return startCaret(right);
};

/** Shift+Enter: a `<br>` line break, or a newline inside code blocks. */
export const insertLineBreak = (root: HTMLElement, range: Range): Caret | null => {
  const block = closestTextBlock(range.startContainer, root);
  if (!block) return null;
  if (block.tagName === 'PRE') return insertNewline(block, range);
  const br = document.createElement('br');
  range.insertNode(br);
  syncTrailingBreak(block);
  return { node: br.parentNode ?? block, offset: indexOf(br) + 1 };
};

/** Inserts plain text at a collapsed range, creating a paragraph if the caret sits between blocks. */
export const insertTextAtCaret = (root: HTMLElement, range: Range, text: string): Caret => {
  let { startContainer: container, startOffset: offset } = range;
  if (!closestTextBlock(container, root) && !isText(container)) {
    const paragraph = createParagraph();
    container.insertBefore(paragraph, container.childNodes[offset] ?? null);
    container = paragraph;
    offset = 0;
  }
  if (isText(container)) {
    container.insertData(offset, text);
    return { node: container, offset: offset + text.length };
  }
  // Joining a neighbouring text node keeps the markup free of fragmented text nodes.
  const before = container.childNodes[offset - 1];
  if (isText(before)) {
    before.appendData(text);
    return { node: before, offset: before.length };
  }
  const after = container.childNodes[offset] ?? null;
  if (isText(after)) {
    after.insertData(0, text);
    return { node: after, offset: text.length };
  }
  const node = document.createTextNode(text);
  container.insertBefore(node, after);
  if (isTextBlock(container)) syncTrailingBreak(container);
  return { node, offset: text.length };
};

/**
 * Inserts an inline atom (a variable chip or a footnote reference) at a collapsed range, creating a paragraph if the caret sits between
 * blocks. Code blocks hold plain text only, so nothing is inserted there.
 * @returns the caret right after the element, or `null` when it could not be inserted.
 */
export const insertInlineAtCaret = (root: HTMLElement, range: Range, element: HTMLElement): Caret | null => {
  let { startContainer: container, startOffset: offset } = range;
  const block = closestTextBlock(container, root);
  if (block?.tagName === 'PRE') return null;
  if (!block && !isText(container)) {
    const paragraph = createParagraph();
    container.insertBefore(paragraph, container.childNodes[offset] ?? null);
    container = paragraph;
    offset = 0;
  }
  const target = document.createRange();
  target.setStart(container, offset);
  target.insertNode(element);
  const parent = closestTextBlock(element, root);
  if (parent) syncTrailingBreak(parent);
  return { node: element.parentNode ?? root, offset: indexOf(element) + 1 };
};

/**
 * Inline atom (variable chip or footnote reference) right before (`backward`) or right after the collapsed caret, with
 * nothing visible in between, so Backspace and Delete remove it as one character in every browser.
 */
export const adjacentInlineAtom = (root: HTMLElement, range: Range, backward: boolean): HTMLElement | null => {
  const block = closestTextBlock(range.startContainer, root);
  if (!block || !range.collapsed) return null;
  const chips = Array.from(block.querySelectorAll<HTMLElement>(INLINE_ATOM_SELECTOR));
  for (const chip of backward ? chips.reverse() : chips) {
    const side = range.comparePoint(chip, 0);
    if (backward ? side >= 0 : side <= 0) continue;
    const between = document.createRange();
    if (backward) {
      between.setStartAfter(chip);
      between.setEnd(range.startContainer, range.startOffset);
    } else {
      between.setStart(range.startContainer, range.startOffset);
      between.setEndBefore(chip);
    }
    return isVisuallyEmpty(between) ? chip : null;
  }
  return null;
};

/**
 * Pastes sanitised blocks at a collapsed range. A single paragraph flows into the current line; several blocks
 * split the current block, with the first and last pasted paragraphs merging into its halves as in Word.
 * @returns the caret after the inserted content.
 */
export const insertFragment = (root: HTMLElement, range: Range, fragment: DocumentFragment): Caret | null => {
  const nodes = Array.from(fragment.childNodes);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (!first || !last) return null;
  const block = closestTextBlock(range.startContainer, root);

  if (!block) {
    root.append(fragment);
    return isTextBlock(last) ? endCaret(last) : null;
  }
  if (block.tagName === 'PRE') {
    const text = nodes.map(node => node.textContent ?? '').join('\n');
    return insertTextAtCaret(root, range, text);
  }

  if (nodes.length === 1 && isElement(first) && first.tagName === 'P') {
    const inline = Array.from(first.childNodes).filter(node => !isTrailingBreak(node));
    const tail = inline.at(-1);
    if (!tail) return { node: range.startContainer, offset: range.startOffset };
    const piece = document.createDocumentFragment();
    piece.append(...inline);
    range.insertNode(piece);
    syncTrailingBreak(block);
    return isText(tail)
      ? { node: tail, offset: tail.length }
      : { node: tail.parentNode ?? block, offset: indexOf(tail) + 1 };
  }

  const right = splitBlock(block, range.startContainer, range.startOffset);
  block.after(...nodes);
  if (isElement(first) && first.tagName === 'P' && !isEmptyTextBlock(block)) mergeBlocks(block, first, root);
  let caret: Caret;
  if (isTextBlock(last) && last.isConnected && last.tagName !== 'PRE') {
    if (isEmptyTextBlock(right)) {
      // Pasting at the end of a line must not leave an empty paragraph behind.
      caret = endCaret(last);
      right.remove();
    } else {
      caret = mergeBlocks(last, right, root);
    }
  } else {
    caret = startCaret(right);
  }
  if (block.isConnected && isEmptyTextBlock(block) && block.nextElementSibling) block.remove();
  return caret;
};

/** Whether the range is collapsed before any visible content of the block. */
export const isCaretAtBlockStart = (block: HTMLElement, range: Range): boolean =>
  range.collapsed && isAtBlockStart(block, range.startContainer, range.startOffset);

/** Whether the range is collapsed after all visible content of the block. */
export const isCaretAtBlockEnd = (block: HTMLElement, range: Range): boolean =>
  range.collapsed && isAtBlockEnd(block, range.startContainer, range.startOffset);
