import {
  closestTextBlock,
  closestWithin,
  isElement,
  isText,
  mergeAdjacentMarks,
  removeEmptyMarks,
  syncTrailingBreak,
  unwrap
} from './dom';

/** Toggleable inline formatting, each rendered as its own element. */
export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'subscript' | 'superscript';

/** Inline formatting stored as CSS properties on a `<span>`. */
export type StyleName = 'color' | 'fontFamily' | 'fontSize';

/** Formatting chosen while the caret is collapsed; applied to the next typed text. */
export interface PendingFormat {
  /** Marks forced on (`true`) or off (`false`); missing marks follow the surrounding text. */
  marks: Partial<Record<MarkName, boolean>>;
  /** Span styles to apply; `null` removes the style, missing styles follow the surrounding text. */
  styles: Partial<Record<StyleName, string | null>>;
  /** Highlight colour; `null` removes the highlight, `undefined` follows the surrounding text. */
  highlight?: string | null;
}

/** Colour used when a highlight is applied without choosing one, e.g. by `==text==` or Mod+Shift+H. */
export const DEFAULT_HIGHLIGHT_COLOR = '#fef08a';

/** Element tag of every mark, in the nesting order used when marks are created. */
const MARK_TAG: Record<MarkName, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
  strike: 'S',
  code: 'CODE',
  subscript: 'SUB',
  superscript: 'SUP'
};

/** CSS property written for every span style. */
const STYLE_PROPERTY: Record<StyleName, string> = { color: 'color', fontFamily: 'font-family', fontSize: 'font-size' };

/** Every element that carries inline formatting; removed by "clear formatting". */
const FORMATTING_TAGS = new Set(['STRONG', 'EM', 'U', 'S', 'CODE', 'SUB', 'SUP', 'SPAN', 'MARK', 'A']);

/** `rel` written on links so opened pages cannot reach back into the application. */
const LINK_REL = 'noopener noreferrer nofollow';

/** Nearest ancestor matching the predicate without leaving the text block that contains `node`. */
const ancestorWithin = (node: Node, root: HTMLElement, predicate: (element: HTMLElement) => boolean) =>
  closestWithin(node, closestTextBlock(node, root) ?? root, predicate);

/** Nearest mark element with the given tag around `node`. */
const markAncestor = (node: Node, root: HTMLElement, tag: string) =>
  ancestorWithin(node, root, element => element.tagName === tag);

/** Nearest `<span>` around `node` that sets the given CSS property. */
const styleAncestor = (node: Node, root: HTMLElement, property: string) =>
  ancestorWithin(node, root, element => element.tagName === 'SPAN' && element.style.getPropertyValue(property) !== '');

/** Nearest `<mark>` highlight around `node`. */
const highlightAncestor = (node: Node, root: HTMLElement) =>
  ancestorWithin(node, root, element => element.tagName === 'MARK');

/** Link containing `node`; links may span several blocks' worth of inline markup, so the search stops at `root`. */
export const linkAncestor = (node: Node, root: HTMLElement): HTMLAnchorElement | null =>
  closestWithin(node, root, element => element.tagName === 'A') as HTMLAnchorElement | null;

/** Splits text nodes at the range edges so every selected character sits in a fully selected text node. */
const splitRangeBoundaries = (range: Range): void => {
  const { endContainer, endOffset } = range;
  if (isText(endContainer) && endOffset > 0 && endOffset < endContainer.length) endContainer.splitText(endOffset);
  const { startContainer, startOffset } = range;
  if (isText(startContainer) && startOffset > 0 && startOffset < startContainer.length) {
    startContainer.splitText(startOffset);
  }
};

/** Text nodes with at least one selected character, skipping code blocks and text outside blocks. */
export const selectedTextNodes = (root: HTMLElement, range: Range): Text[] => {
  if (range.collapsed) return [];
  const ancestor = range.commonAncestorContainer;
  const scope = isText(ancestor) ? (ancestor.parentNode ?? root) : ancestor;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!range.intersectsNode(text)) continue;
    const block = closestTextBlock(text, root);
    if (!block || block.tagName === 'PRE') continue;
    const from = text === range.startContainer ? range.startOffset : 0;
    const to = text === range.endContainer ? range.endOffset : text.length;
    if (to > from) nodes.push(text);
  }
  return nodes;
};

/** Splits the parent of `child` into up to three shallow copies so `child` ends up alone in the middle one. */
const splitAroundChild = (child: Node) => {
  const parent = child.parentNode as HTMLElement;
  if (child.previousSibling) {
    const before = parent.cloneNode(false) as HTMLElement;
    while (parent.firstChild && parent.firstChild !== child) before.append(parent.firstChild);
    parent.before(before);
  }
  if (child.nextSibling) {
    const after = parent.cloneNode(false) as HTMLElement;
    while (child.nextSibling) after.append(child.nextSibling);
    parent.after(after);
  }
};

/** Splits `ancestor` and every element below it so that `ancestor` wraps exactly `node`. */
const isolate = (node: Node, ancestor: HTMLElement): HTMLElement => {
  let current: Node = node;
  while (current !== ancestor && current.parentNode) {
    splitAroundChild(current);
    current = current.parentNode;
  }
  return ancestor;
};

/** Wraps a text node in a new element with the given tag and returns that element. */
const wrapText = (node: Text, tag: string): HTMLElement => {
  const element = document.createElement(tag);
  node.before(element);
  element.append(node);
  return element;
};

/** Writes the colour of a `<mark>` in the attribute and inline-style form the sanitiser also produces. */
const setHighlightAttributes = (mark: HTMLElement, color: string) => {
  mark.setAttribute('data-color', color);
  mark.setAttribute('style', `background-color: ${color}; color: inherit`);
};

/** Removes empty marks, merges identical neighbours and fixes caret placeholders in the blocks that were edited. */
const tidyBlocks = (root: HTMLElement, nodes: Node[]) => {
  const blocks = new Set(nodes.map(node => closestTextBlock(node, root)));
  for (const block of blocks) {
    if (!block?.isConnected) continue;
    removeEmptyMarks(block);
    mergeAdjacentMarks(block);
    syncTrailingBreak(block);
  }
};

/**
 * Runs `apply` for every selected text node after splitting the range edges, then tidies the touched blocks.
 * @returns whether any text was selected.
 */
const eachSelectedText = (root: HTMLElement, range: Range, apply: (node: Text) => void) => {
  splitRangeBoundaries(range);
  const nodes = selectedTextNodes(root, range);
  for (const node of nodes) apply(node);
  tidyBlocks(root, nodes);
  return nodes.length > 0;
};

/** Whether the mark applies at the caret, or to every selected character of a non-collapsed range. */
export const isMarkActive = (root: HTMLElement, range: Range, mark: MarkName): boolean => {
  const tag = MARK_TAG[mark];
  if (range.collapsed) return markAncestor(range.startContainer, root, tag) !== null;
  const nodes = selectedTextNodes(root, range);
  return nodes.length > 0 && nodes.every(node => markAncestor(node, root, tag) !== null);
};

/**
 * Removes the mark when the whole selection already has it, otherwise adds it to every selected character.
 * Subscript and superscript exclude each other.
 */
export const toggleMark = (root: HTMLElement, range: Range, mark: MarkName): void => {
  const tag = MARK_TAG[mark];
  splitRangeBoundaries(range);
  const nodes = selectedTextNodes(root, range);
  const active = nodes.length > 0 && nodes.every(node => markAncestor(node, root, tag) !== null);
  const opposite = mark === 'subscript' ? MARK_TAG.superscript : mark === 'superscript' ? MARK_TAG.subscript : null;
  for (const node of nodes) {
    const existing = markAncestor(node, root, tag);
    if (active) {
      if (existing) unwrap(isolate(node, existing));
      continue;
    }
    const excluded = opposite ? markAncestor(node, root, opposite) : null;
    if (excluded) unwrap(isolate(node, excluded));
    if (!existing) wrapText(node, tag);
  }
  tidyBlocks(root, nodes);
};

/** Sets (or with `null` removes) a span style on the selected text, reusing spans that already carry it. */
export const setTextStyle = (root: HTMLElement, range: Range, name: StyleName, value: string | null): void => {
  const property = STYLE_PROPERTY[name];
  eachSelectedText(root, range, node => {
    const existing = styleAncestor(node, root, property);
    if (existing) {
      const span = isolate(node, existing);
      if (value) span.style.setProperty(property, value);
      else span.style.removeProperty(property);
      if (!span.getAttribute('style')) unwrap(span);
    } else if (value) {
      wrapText(node, 'span').style.setProperty(property, value);
    }
  });
};

/** Highlights the selected text with a colour, or removes the highlight with `null`. */
export const setHighlight = (root: HTMLElement, range: Range, color: string | null): void => {
  eachSelectedText(root, range, node => {
    const existing = highlightAncestor(node, root);
    if (existing) {
      const mark = isolate(node, existing);
      if (color) setHighlightAttributes(mark, color);
      else unwrap(mark);
    } else if (color) {
      setHighlightAttributes(wrapText(node, 'mark'), color);
    }
  });
};

/**
 * Turns the selected text into a link, replacing any link it was part of.
 * @returns whether any text was selected.
 */
export const setLink = (root: HTMLElement, range: Range, href: string, target: string | null): boolean =>
  eachSelectedText(root, range, node => {
    const existing = linkAncestor(node, root);
    if (existing) unwrap(isolate(node, existing));
    const link = wrapText(node, 'a');
    link.setAttribute('href', href);
    link.setAttribute('rel', LINK_REL);
    if (target) link.setAttribute('target', target);
  });

/** Removes links from the selected text, keeping the text itself. */
export const unsetLink = (root: HTMLElement, range: Range): void => {
  eachSelectedText(root, range, node => {
    const existing = linkAncestor(node, root);
    if (existing) unwrap(isolate(node, existing));
  });
};

/** Removes every mark, span style, highlight and link from the selected text. */
export const clearMarks = (root: HTMLElement, range: Range): void => {
  const isFormatting = (element: HTMLElement) => FORMATTING_TAGS.has(element.tagName);
  eachSelectedText(root, range, node => {
    let mark = ancestorWithin(node, root, isFormatting);
    while (mark) {
      unwrap(isolate(node, mark));
      mark = ancestorWithin(node, root, isFormatting);
    }
  });
};

/** Which marks apply to `node`. */
export const readMarks = (root: HTMLElement, node: Node): Record<MarkName, boolean> => {
  const result = {} as Record<MarkName, boolean>;
  for (const [name, tag] of Object.entries(MARK_TAG) as Array<[MarkName, string]>) {
    result[name] = markAncestor(node, root, tag) !== null;
  }
  return result;
};

/** Value of a span style at `node`, or an empty string when none is set. */
export const readStyle = (root: HTMLElement, node: Node, name: StyleName): string =>
  styleAncestor(node, root, STYLE_PROPERTY[name])?.style.getPropertyValue(STYLE_PROPERTY[name]) ?? '';

/** Highlight colour at `node`, the default colour for a `<mark>` without one, or an empty string. */
export const readHighlight = (root: HTMLElement, node: Node): string => {
  const mark = highlightAncestor(node, root);
  if (!mark) return '';
  return mark.getAttribute('data-color') || mark.style.backgroundColor || DEFAULT_HIGHLIGHT_COLOR;
};

/**
 * Inserts text at a collapsed caret with formatting that differs from its surroundings: the inline elements
 * around the caret are split and the text is wrapped in exactly the requested marks.
 */
export const insertFormattedText = (root: HTMLElement, range: Range, text: string, format: PendingFormat): void => {
  const block = closestTextBlock(range.startContainer, root);
  if (!block) return;
  const anchor = range.startContainer;
  const marks = { ...readMarks(root, anchor), ...format.marks };
  const styles: Record<StyleName, string> = {
    color: readStyle(root, anchor, 'color'),
    fontFamily: readStyle(root, anchor, 'fontFamily'),
    fontSize: readStyle(root, anchor, 'fontSize')
  };
  for (const [name, value] of Object.entries(format.styles) as Array<[StyleName, string | null]>) {
    styles[name] = value ?? '';
  }
  const highlight = format.highlight === undefined ? readHighlight(root, anchor) : (format.highlight ?? '');
  const link = linkAncestor(anchor, root);

  // Everything after the caret moves to the end of the block, splitting the marks around the caret.
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(block, block.childNodes.length);
  const right = tail.extractContents();
  const reference = right.firstChild;
  block.append(right);

  let node: Node = document.createTextNode(text);
  const wrapNode = (element: HTMLElement) => {
    element.append(node);
    node = element;
  };
  for (const [name, tag] of Object.entries(MARK_TAG) as Array<[MarkName, string]>) {
    if (marks[name]) wrapNode(document.createElement(tag));
  }
  const css = (Object.keys(STYLE_PROPERTY) as StyleName[])
    .filter(name => styles[name])
    .map(name => `${STYLE_PROPERTY[name]}: ${styles[name]}`);
  if (css.length) {
    const span = document.createElement('span');
    span.setAttribute('style', css.join('; '));
    wrapNode(span);
  }
  if (highlight) {
    const mark = document.createElement('mark');
    setHighlightAttributes(mark, highlight);
    wrapNode(mark);
  }
  if (link && isElement(reference) && link.contains(anchor)) wrapNode(link.cloneNode(false) as HTMLElement);

  block.insertBefore(node, reference && reference.parentNode === block ? reference : null);
  removeEmptyMarks(block);
  mergeAdjacentMarks(block);
  syncTrailingBreak(block);
};
