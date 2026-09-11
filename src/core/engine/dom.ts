/**
 * Framework-free DOM helpers shared by every part of the editing engine: node type guards, lookups that never leave
 * the editor root, element factories and the small structural fixes (caret placeholders, mark merging) that keep the
 * editable markup predictable.
 */

/** Tags of blocks that hold editable inline text. */
const TEXT_BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);

/** Tags of ordered and unordered lists. */
const LIST_TAGS = new Set(['UL', 'OL']);

/** Tags of inline formatting elements (marks). */
const MARK_TAGS = new Set(['STRONG', 'EM', 'U', 'S', 'CODE', 'SUB', 'SUP', 'A', 'MARK', 'SPAN']);

/** Selector matching every mark element, used to scan a subtree for formatting. */
const MARK_SELECTOR = 'strong, em, u, s, code, sub, sup, a, mark, span';

/** Selector for blocks without editable text inside: rules, images and page breaks. */
export const ATOM_SELECTOR = 'hr, img, div[data-type="page-break"]';

/** Selector for blocks that hold editable inline text. */
export const TEXT_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, pre';

/** Marks the extra `<br>` that keeps an empty or break-terminated line visible; it is never serialised. */
export const TRAILING_BREAK = 'data-doc-trailing';

/** Inline content a user can see besides text: images and real (non-placeholder) line breaks. */
const VISIBLE_INLINE_SELECTOR = `img, br:not([${TRAILING_BREAK}])`;

/** Whether the node is an element. */
export const isElement = (node: Node | null | undefined): node is HTMLElement => node?.nodeType === Node.ELEMENT_NODE;

/** Whether the node is a text node. */
export const isText = (node: Node | null | undefined): node is Text => node?.nodeType === Node.TEXT_NODE;

/** Whether the node is a paragraph, heading or code block. */
export const isTextBlock = (node: Node | null | undefined): node is HTMLElement =>
  isElement(node) && TEXT_BLOCK_TAGS.has(node.tagName);

/** Whether the node is an ordered or unordered list. */
export const isList = (node: Node | null | undefined): node is HTMLElement =>
  isElement(node) && LIST_TAGS.has(node.tagName);

/** Whether the node is an inline formatting element. */
const isMark = (node: Node | null | undefined): node is HTMLElement => isElement(node) && MARK_TAGS.has(node.tagName);

/** Whether the node is a block without editable text (rule, image, page break). */
export const isAtom = (node: Node | null | undefined): node is HTMLElement =>
  isElement(node) && node.matches(ATOM_SELECTOR);

/** Whether the node is a `<br>`, placeholder or real. */
export const isBreak = (node: Node | null | undefined): node is HTMLBRElement =>
  isElement(node) && node.tagName === 'BR';

/** Whether the node is the editor's placeholder `<br>` rather than a line break typed by the user. */
export const isTrailingBreak = (node: Node | null | undefined): boolean =>
  isBreak(node) && node.hasAttribute(TRAILING_BREAK);

/** Nearest ancestor-or-self matching the predicate, never leaving `root` (which itself is never returned). */
export const closestWithin = (
  node: Node | null | undefined,
  root: HTMLElement,
  predicate: (element: HTMLElement) => boolean
): HTMLElement | null => {
  let current: Node | null | undefined = node;
  while (current && current !== root) {
    if (isElement(current) && predicate(current)) return current;
    current = current.parentNode;
  }
  return null;
};

/** Nearest ancestor-or-self inside `root` whose tag is `tags` or one of `tags`. */
export const closestTag = (
  node: Node | null | undefined,
  root: HTMLElement,
  tags: string | ReadonlySet<string>
): HTMLElement | null =>
  closestWithin(node, root, element =>
    typeof tags === 'string' ? element.tagName === tags : tags.has(element.tagName)
  );

/** The paragraph, heading or code block containing `node`. */
export const closestTextBlock = (node: Node | null | undefined, root: HTMLElement): HTMLElement | null =>
  closestWithin(node, root, element => TEXT_BLOCK_TAGS.has(element.tagName));

/** Creates an element with attributes and children in one call. */
export const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
};

/** Creates the placeholder `<br>` that gives empty lines their height. */
export const createTrailingBreak = (): HTMLBRElement => createElement('br', { [TRAILING_BREAK]: '' });

/** Creates a paragraph with the given inline content and the placeholder break it needs. */
export const createParagraph = (children: Node[] = []): HTMLParagraphElement => {
  const paragraph = createElement('p', {}, children);
  syncTrailingBreak(paragraph);
  return paragraph;
};

/** Whether the element contains text, an image or a real line break. */
export const hasVisibleContent = (element: Element): boolean =>
  (element.textContent ?? '') !== '' || element.querySelector(VISIBLE_INLINE_SELECTOR) !== null;

/** Whether a text block has no text and no image, holding at most one break. */
export const isEmptyTextBlock = (block: Element): boolean =>
  (block.textContent ?? '') === '' && block.querySelector('img') === null && block.querySelectorAll('br').length <= 1;

/** The last child (or the last one before `before`) that is not an empty text node. */
const lastMeaningfulChild = (element: Node, before?: Node | null): Node | null => {
  let node = before === undefined ? element.lastChild : (before?.previousSibling ?? null);
  while (node && isText(node) && node.data === '') node = node.previousSibling;
  return node;
};

/**
 * Keeps exactly one placeholder `<br>` where the browser needs it: in empty blocks and after a user line break at the
 * end of a block. Leaves the DOM untouched when nothing has to change, so the caret is not disturbed while typing.
 */
export const syncTrailingBreak = (block: HTMLElement): void => {
  if (block.tagName === 'PRE') return;
  if (isEmptyTextBlock(block)) {
    const only = block.firstChild;
    const single = block.childNodes.length === 1;
    if (single && isBreak(only)) {
      only.setAttribute(TRAILING_BREAK, '');
      return;
    }
    if (single && isTrailingBreak(only)) return;
    // Empty marks stay so a pending bold or colour survives; only the breaks are rebuilt.
    for (const br of Array.from(block.querySelectorAll('br'))) br.remove();
    block.append(createTrailingBreak());
    return;
  }
  const last = lastMeaningfulChild(block);
  const trailing = isBreak(last) && last.hasAttribute(TRAILING_BREAK) ? last : null;
  const beforeTrailing = trailing ? lastMeaningfulChild(block, trailing) : last;
  const needed = beforeTrailing === null || isBreak(beforeTrailing);
  if (needed && !trailing) block.append(createTrailingBreak());
  if (!needed && trailing) trailing.remove();
};

/** Replaces an element with its own children. */
export const unwrap = (element: Element): void => {
  element.replaceWith(...Array.from(element.childNodes));
};

/** Replaces the element with one of another tag, keeping attributes and children. */
export const renameElement = <T extends HTMLElement = HTMLElement>(element: HTMLElement, tag: string): T => {
  const renamed = document.createElement(tag);
  for (const attribute of Array.from(element.attributes)) renamed.setAttribute(attribute.name, attribute.value);
  renamed.append(...Array.from(element.childNodes));
  element.replaceWith(renamed);
  return renamed as T;
};

/** Whether two elements carry exactly the same attributes and values. */
const sameAttributes = (a: Element, b: Element): boolean =>
  a.attributes.length === b.attributes.length &&
  Array.from(a.attributes).every(attribute => b.getAttribute(attribute.name) === attribute.value);

/** Removes marks that no longer contain anything the user can see or place a caret into. */
export const removeEmptyMarks = (scope: HTMLElement): void => {
  // Innermost marks come last in document order, so walking backwards empties nested marks bottom-up.
  const marks = Array.from(scope.querySelectorAll<HTMLElement>(MARK_SELECTOR));
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (mark && !hasVisibleContent(mark)) mark.remove();
  }
};

/** Joins neighbouring marks with identical tag and attributes, then merges adjacent text nodes. */
export const mergeAdjacentMarks = (scope: HTMLElement): void => {
  /** Merges equal siblings among the children of `parent`, then descends into every child element. */
  const visit = (parent: Node) => {
    let child = parent.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (isMark(child) && isMark(next) && child.tagName === next.tagName && sameAttributes(child, next)) {
        child.append(...Array.from(next.childNodes));
        next.remove();
        continue;
      }
      if (isElement(child)) visit(child);
      child = next;
    }
  };
  visit(scope);
  scope.normalize();
};

/** All paragraphs, headings and code blocks inside `scope`, in document order. */
export const textBlocksWithin = (scope: ParentNode): HTMLElement[] =>
  Array.from(scope.querySelectorAll<HTMLElement>(TEXT_BLOCK_SELECTOR));

/** Text blocks touched by the range, in document order. */
export const textBlocksInRange = (root: HTMLElement, range: Range): HTMLElement[] => {
  const startBlock = closestTextBlock(range.startContainer, root);
  if (range.collapsed || startBlock === closestTextBlock(range.endContainer, root)) {
    return startBlock ? [startBlock] : [];
  }
  return textBlocksWithin(root).filter(block => range.intersectsNode(block));
};

/** Range from the start of `block` to a point (`toEnd` false) or from a point to the end of `block` (`toEnd` true). */
const rangeBetween = (block: HTMLElement, container: Node, offset: number, toEnd: boolean): Range => {
  const range = document.createRange();
  range.selectNodeContents(block);
  if (toEnd) range.setStart(container, offset);
  else range.setEnd(container, offset);
  return range;
};

/** Whether a range covers no text, image or real line break. */
const isVisuallyEmpty = (range: Range): boolean =>
  range.toString() === '' && range.cloneContents().querySelector(VISIBLE_INLINE_SELECTOR) === null;

/** Whether nothing visible precedes the point inside its block. */
export const isAtBlockStart = (block: HTMLElement, container: Node, offset: number): boolean =>
  isVisuallyEmpty(rangeBetween(block, container, offset, false));

/** Whether nothing visible follows the point inside its block. */
export const isAtBlockEnd = (block: HTMLElement, container: Node, offset: number): boolean =>
  isVisuallyEmpty(rangeBetween(block, container, offset, true));

/** Escapes regular-expression syntax so user text can be searched literally. */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
