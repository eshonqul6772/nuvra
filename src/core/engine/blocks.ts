import {
  closestTag,
  closestTextBlock,
  closestWithin,
  createElement,
  createParagraph,
  createTrailingBreak,
  isAtBlockEnd,
  isAtBlockStart,
  isEmptyTextBlock,
  isTextBlock,
  removeEmptyMarks,
  renameElement,
  syncTrailingBreak,
  textBlocksInRange,
  unwrap
} from './dom';
import { GAP_ATTRIBUTE, SPACE_AFTER_ATTRIBUTE, SPACE_BEFORE_ATTRIBUTE, setIndent } from './schema';

/** Heading element tags. */
export type HeadingTag = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';

/** Paragraph alignment; `left` is the default and is stored as no style. */
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** Paragraph direction; `auto` is stored as no `dir` attribute. */
export type TextDirection = 'auto' | 'ltr' | 'rtl';

/** Elements whose children are blocks rather than inline content. */
const CONTAINER_TAGS = new Set(['BLOCKQUOTE', 'TD', 'TH', 'LI']);

/** The element whose children are blocks: the document, a quote, a list item body or a table cell. */
export const containerOf = (node: Node, root: HTMLElement): HTMLElement =>
  closestWithin(
    node.parentNode,
    root,
    element =>
      CONTAINER_TAGS.has(element.tagName) ||
      (element.tagName === 'DIV' && element.parentElement?.getAttribute('data-type') === 'taskItem')
  ) ?? root;

/** The direct child of `container` that contains `node` (or `node` itself when it is a direct child). */
export const childOf = (container: Node, node: Node): Node => {
  let current = node;
  while (current.parentNode && current.parentNode !== container) current = current.parentNode;
  return current;
};

/** Drops an empty `style` attribute left behind after removing the last inline property. */
const removeEmptyStyle = (element: HTMLElement) => {
  if (!element.getAttribute('style')) element.removeAttribute('style');
};

/** Replaces a code block with one block of `tag` per line of its text. */
const codeBlockToBlocks = (pre: HTMLElement, tag: string) => {
  const lines = (pre.textContent ?? '').replace(/\n$/, '').split('\n');
  const blocks = lines.map(line => {
    const block = document.createElement(tag.toLowerCase());
    if (line) block.append(line);
    syncTrailingBreak(block);
    return block;
  });
  pre.replaceWith(...blocks);
};

/** Turns every selected text block into a paragraph or heading, keeping its alignment and indentation. */
export const setBlockType = (root: HTMLElement, range: Range, tag: 'P' | HeadingTag): void => {
  for (const block of textBlocksInRange(root, range)) {
    if (block.tagName === tag) continue;
    if (block.tagName === 'PRE') codeBlockToBlocks(block, tag);
    else syncTrailingBreak(renameElement(block, tag.toLowerCase()));
  }
};

/** Converts the selected blocks to code blocks, or back to paragraphs when all of them already are. */
export const toggleCodeBlock = (root: HTMLElement, range: Range): void => {
  const blocks = textBlocksInRange(root, range);
  if (blocks.length && blocks.every(block => block.tagName === 'PRE')) {
    setBlockType(root, range, 'P');
    return;
  }
  for (const block of blocks) {
    if (block.tagName === 'PRE') continue;
    const text = block.textContent ?? '';
    const code = createElement('code', {}, text ? [text] : [createTrailingBreak()]);
    block.replaceWith(createElement('pre', {}, [code]));
  }
};

/**
 * Unwraps the quotes around the selection when every selected block is quoted; otherwise wraps the selected
 * blocks, at the level of their closest common container, in a new quote.
 */
export const toggleBlockquote = (root: HTMLElement, range: Range): void => {
  const blocks = textBlocksInRange(root, range);
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last) return;

  const quotes = blocks.map(block => closestTag(block, root, 'BLOCKQUOTE'));
  if (quotes.every(Boolean)) {
    for (const quote of new Set(quotes)) if (quote) unwrap(quote);
    return;
  }

  let container = containerOf(first, root);
  while (container !== root && !container.contains(last)) container = containerOf(container, root);
  const start = childOf(container, first);
  const end = childOf(container, last);
  const quote = createElement('blockquote');
  start.parentNode?.insertBefore(quote, start);
  let node: Node | null = start;
  while (node) {
    const next: Node | null = node === end ? null : node.nextSibling;
    quote.append(node);
    node = next;
  }
};

/** Aligns the selected paragraphs and headings; code blocks keep their alignment. */
export const setTextAlign = (root: HTMLElement, range: Range, align: TextAlign): void => {
  for (const block of textBlocksInRange(root, range)) {
    if (block.tagName === 'PRE') continue;
    if (align === 'left') block.style.removeProperty('text-align');
    else block.style.textAlign = align;
    removeEmptyStyle(block);
  }
};

/** Sets the line height of the selected paragraphs and headings, or resets it with `null`. */
export const setLineHeight = (root: HTMLElement, range: Range, lineHeight: string | null): void => {
  for (const block of textBlocksInRange(root, range)) {
    if (block.tagName === 'PRE') continue;
    if (lineHeight) block.style.lineHeight = lineHeight;
    else block.style.removeProperty('line-height');
    removeEmptyStyle(block);
  }
};

/** Sets the writing direction of the selected blocks; `auto` lets each paragraph follow its own text. */
export const setTextDirection = (root: HTMLElement, range: Range, direction: TextDirection): void => {
  for (const block of textBlocksInRange(root, range)) {
    if (direction === 'auto') block.removeAttribute('dir');
    else block.setAttribute('dir', direction);
  }
};

/** Side of a paragraph that can keep extra space, as in the paragraph settings of office suites. */
export type SpacingSide = 'before' | 'after';

/** Attribute and CSS property that hold the spacing of each side. */
const SPACING: Record<SpacingSide, { attribute: string; property: 'margin-top' | 'margin-bottom' }> = {
  before: { attribute: SPACE_BEFORE_ATTRIBUTE, property: 'margin-top' },
  after: { attribute: SPACE_AFTER_ATTRIBUTE, property: 'margin-bottom' }
};

/** Space a block keeps on one side, in points; `0` when it uses the document default. */
export const paragraphSpacing = (block: HTMLElement, side: SpacingSide): number =>
  Number.parseFloat(block.getAttribute(SPACING[side].attribute) ?? '') || 0;

/**
 * Sets the space before or after the selected paragraphs, in points; `null` restores the document default. The gap
 * pagination may have added is dropped, because it is written into the same margin and is recomputed anyway.
 */
export const setParagraphSpacing = (
  root: HTMLElement,
  range: Range,
  side: SpacingSide,
  points: number | null
): void => {
  const { attribute, property } = SPACING[side];
  for (const block of textBlocksInRange(root, range)) {
    if (block.tagName === 'PRE') continue;
    if (points === null || points <= 0) {
      block.removeAttribute(attribute);
      block.style.removeProperty(property);
    } else {
      block.setAttribute(attribute, String(points));
      block.style.setProperty(property, `${points}pt`);
    }
    if (side === 'before') block.removeAttribute(GAP_ATTRIBUTE);
    removeEmptyStyle(block);
  }
};

/** Paragraph indents in CSS pixels, the exact distances the ruler drags. */
export interface ParagraphIndents {
  /** Distance the paragraph keeps from the left text edge. */
  left: number;
  /** Distance it keeps from the right text edge. */
  right: number;
  /** Extra distance of its first line; a negative value hangs the first line out to the left. */
  firstLine: number;
}

/** Largest indent a paragraph may get, in pixels; about 20 cm, so it always stays on the paper. */
const MAX_INDENT_PX = 760;

/** Keeps a value within the given range. */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Indents of a block; a block without them uses zero. */
export const paragraphIndents = (block: HTMLElement): ParagraphIndents => ({
  left: Math.round(Number.parseFloat(block.style.marginLeft) || 0),
  right: Math.round(Number.parseFloat(block.style.marginRight) || 0),
  firstLine: Math.round(Number.parseFloat(block.style.textIndent) || 0)
});

/**
 * Sets exact indents on the selected paragraphs; a side left out of `patch` keeps its value. Exact indents replace
 * the stepped indentation of the toolbar buttons, so the step attribute is dropped with them.
 */
export const setParagraphIndents = (root: HTMLElement, range: Range, patch: Partial<ParagraphIndents>): void => {
  for (const block of textBlocksInRange(root, range)) {
    if (block.tagName === 'PRE') continue;
    const sides = [
      { value: patch.left, property: 'margin-left', min: 0 },
      { value: patch.right, property: 'margin-right', min: 0 },
      { value: patch.firstLine, property: 'text-indent', min: -MAX_INDENT_PX }
    ] as const;
    for (const side of sides) {
      if (side.value === undefined) continue;
      const value = Math.round(clamp(side.value, side.min, MAX_INDENT_PX));
      if (value === 0) block.style.removeProperty(side.property);
      else block.style.setProperty(side.property, `${value}px`);
    }
    if (patch.left !== undefined) block.removeAttribute('data-indent');
    removeEmptyStyle(block);
  }
};

/** Reads the indentation step stored on a block. */
const indentOf = (block: HTMLElement) => Number.parseInt(block.dataset.indent ?? '0', 10) || 0;

/**
 * Moves the selected paragraphs outside lists by whole indentation steps.
 * @returns whether any block's indentation changed.
 */
export const changeIndent = (root: HTMLElement, range: Range, delta: number): boolean => {
  let changed = false;
  for (const block of textBlocksInRange(root, range)) {
    if (block.tagName === 'PRE' || closestTag(block, root, 'LI')) continue;
    const current = indentOf(block);
    setIndent(block, current + delta);
    changed ||= indentOf(block) !== current;
  }
  return changed;
};

/** Splits a text block at a point; the new right-hand block keeps the tag and paragraph formatting. */
export const splitBlock = (block: HTMLElement, container: Node, offset: number): HTMLElement => {
  const tail = document.createRange();
  tail.setStart(container, offset);
  tail.setEnd(block, block.childNodes.length);
  const right = block.cloneNode(false) as HTMLElement;
  right.append(tail.extractContents());
  block.after(right);
  for (const part of [block, right]) {
    removeEmptyMarks(part);
    syncTrailingBreak(part);
  }
  return right;
};

/**
 * Places a block element (rule, page break, image, table) at the caret and returns the text block that should
 * receive the caret afterwards.
 */
export const insertBlockAtCaret = (root: HTMLElement, range: Range, element: HTMLElement): HTMLElement => {
  const block = closestTextBlock(range.startContainer, root);
  if (!block) {
    const paragraph = createParagraph();
    root.append(element, paragraph);
    return paragraph;
  }
  if (isEmptyTextBlock(block) || isAtBlockStart(block, range.startContainer, range.startOffset)) {
    block.before(element);
    return block;
  }
  if (isAtBlockEnd(block, range.endContainer, range.endOffset)) {
    block.after(element);
    const next = element.nextElementSibling;
    if (isTextBlock(next)) return next;
    const paragraph = createParagraph();
    element.after(paragraph);
    return paragraph;
  }
  const right = splitBlock(block, range.startContainer, range.startOffset);
  block.after(element);
  return right;
};
