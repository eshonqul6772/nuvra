import { TRAILING_BREAK, closestTextBlock, isAtom, isBreak, isElement, isText, isTrailingBreak } from './dom';

/**
 * Selection positions expressed as character offsets through the document. Unlike DOM ranges they stay valid when
 * the markup around the text is rebuilt (marks merged, blocks renamed, history restored).
 */
export interface TextBookmark {
  /** Offset where the selection starts (for a saved selection: where the user started selecting). */
  anchor: number;
  /** Offset where the selection ends (for a saved selection: where the caret currently is). */
  focus: number;
}

/** A caret-bearing node with its position in the flattened document. */
interface Leaf {
  /** Text node, real line break, trailing placeholder break or atom block. */
  node: Node;
  /** Offset of the leaf's first position. */
  start: number;
  /** Number of positions the leaf occupies: text length, 1 for breaks and atoms, 0 for placeholders. */
  size: number;
  /** Text block containing the leaf, used to insert one position between blocks. */
  block: HTMLElement | null;
}

/** A DOM boundary point: a node and an offset inside it. */
interface BoundaryPoint {
  /** Container node of the boundary. */
  node: Node;
  /** Character offset for text nodes, child index for elements. */
  offset: number;
}

/** Index of a node among its parent's child nodes, or -1 when it has no parent. */
export const indexOf = (node: Node): number => Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node);

/** Positions a node occupies, or `null` when the node cannot hold the caret (for example text between blocks). */
const leafSize = (node: Node, root: HTMLElement): number | null => {
  if (isText(node)) return closestTextBlock(node, root) ? node.data.length : null;
  if (isBreak(node)) return node.hasAttribute(TRAILING_BREAK) ? 0 : 1;
  return isAtom(node) ? 1 : null;
};

/** Lists every caret-bearing node with its offset; entering a new text block adds one position, like a line break. */
const collectLeaves = (root: HTMLElement): Leaf[] => {
  const leaves: Leaf[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let position = 0;
  let previousBlock: HTMLElement | null | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const size = leafSize(node, root);
    if (size === null) continue;
    const block = closestTextBlock(node, root);
    if (previousBlock !== undefined && block !== previousBlock) position += 1;
    previousBlock = block;
    leaves.push({ node, start: position, size, block });
    position += size;
  }
  return leaves;
};

/** Converts a DOM boundary point into a document offset. */
const positionOf = (root: HTMLElement, leaves: Leaf[], container: Node, offset: number): number => {
  if (isText(container)) {
    const leaf = leaves.find(candidate => candidate.node === container);
    if (leaf) return leaf.start + Math.min(offset, leaf.size);
  }
  const point = document.createRange();
  point.setStart(container, offset);
  const pointBlock = closestTextBlock(container, root);
  let previous: Leaf | null = null;
  for (const leaf of leaves) {
    if (point.comparePoint(leaf.node, 0) > 0) {
      if (!previous || leaf.block === pointBlock) return leaf.start;
      return previous.start + previous.size;
    }
    previous = leaf;
  }
  return previous ? previous.start + previous.size : 0;
};

/** Converts a document offset back into a DOM boundary point, clamping offsets past the end to the last leaf. */
const resolvePosition = (root: HTMLElement, leaves: Leaf[], position: number): BoundaryPoint => {
  for (const leaf of leaves) {
    if (position > leaf.start + leaf.size) continue;
    const target = Math.max(position, leaf.start);
    if (isText(leaf.node)) return { node: leaf.node, offset: target - leaf.start };
    const parent = leaf.node.parentNode ?? root;
    const index = indexOf(leaf.node);
    const before = target === leaf.start || isTrailingBreak(leaf.node);
    return { node: parent, offset: before ? index : index + 1 };
  }
  const last = leaves.at(-1);
  if (!last) return { node: root, offset: 0 };
  if (isText(last.node)) return { node: last.node, offset: last.size };
  return { node: last.node.parentNode ?? root, offset: indexOf(last.node) + (isTrailingBreak(last.node) ? 0 : 1) };
};

/** The current selection range when it lies entirely inside `root`, otherwise `null`. */
export const getRangeWithin = (root: HTMLElement): Range | null => {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.startContainer) && root.contains(range.endContainer) ? range : null;
};

/** Replaces the document selection with `range`. */
export const selectRange = (range: Range): void => {
  const selection = document.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
};

/** Collapses the selection to a boundary point and returns the created range. */
const setCaret = (node: Node, offset: number): Range => {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selectRange(range);
  return range;
};

/** All text nodes inside `element`, in document order. */
const textNodes = (element: Node): Text[] => {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
};

/** Places the caret before the first character of `element`. */
export const placeCaretAtStart = (element: HTMLElement): Range => {
  const first = textNodes(element)[0];
  return first ? setCaret(first, 0) : setCaret(element, 0);
};

/** Places the caret after the last character of `element`, in front of its placeholder break if it has one. */
export const placeCaretAtEnd = (element: HTMLElement): Range => {
  const last = textNodes(element).at(-1);
  if (last) return setCaret(last, last.data.length);
  const trailing = Array.from(element.childNodes).find(isTrailingBreak);
  return setCaret(element, trailing ? indexOf(trailing) : element.childNodes.length);
};

/** Stores a range as document offsets; `anchor` is the start and `focus` the end. */
export const rangeToBookmark = (root: HTMLElement, range: Range): TextBookmark => {
  const leaves = collectLeaves(root);
  const anchor = positionOf(root, leaves, range.startContainer, range.startOffset);
  const focus = range.collapsed ? anchor : positionOf(root, leaves, range.endContainer, range.endOffset);
  return { anchor, focus };
};

/** Rebuilds a forward DOM range from a bookmark. */
export const bookmarkToRange = (root: HTMLElement, bookmark: TextBookmark): Range => {
  const leaves = collectLeaves(root);
  const from = resolvePosition(root, leaves, Math.min(bookmark.anchor, bookmark.focus));
  const to = resolvePosition(root, leaves, Math.max(bookmark.anchor, bookmark.focus));
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
};

/** Stores the current selection, keeping its direction, or returns `null` when it is outside `root`. */
export const saveBookmark = (root: HTMLElement): TextBookmark | null => {
  const selection = document.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return null;
  const leaves = collectLeaves(root);
  return {
    anchor: positionOf(root, leaves, anchorNode, selection.anchorOffset),
    focus: positionOf(root, leaves, focusNode, selection.focusOffset)
  };
};

/** Restores a selection saved with {@link saveBookmark}, including its direction. */
export const restoreBookmark = (root: HTMLElement, bookmark: TextBookmark): void => {
  const leaves = collectLeaves(root);
  const anchor = resolvePosition(root, leaves, bookmark.anchor);
  const focus = resolvePosition(root, leaves, bookmark.focus);
  document.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
};

/** Scrolls the caret line into view inside the nearest scroll container. */
export const scrollSelectionIntoView = (root: HTMLElement): void => {
  const range = getRangeWithin(root);
  if (!range) return;
  const target = isElement(range.startContainer) ? range.startContainer : range.startContainer.parentElement;
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};
