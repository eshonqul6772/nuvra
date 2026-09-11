import { childOf, containerOf } from './blocks';
import { closestTag, createElement, isList, renameElement, textBlocksInRange, unwrap } from './dom';
import { ensureTaskItem, listItemBody } from './schema';

/** The three list types; the names match the toolbar state keys. */
export type ListKind = 'bulletList' | 'orderedList' | 'taskList';

/** Kind of a `<ul>`/`<ol>` element; task lists are `<ul data-type="taskList">`. */
export const listKind = (list: Element): ListKind =>
  list.tagName === 'OL' ? 'orderedList' : list.getAttribute('data-type') === 'taskList' ? 'taskList' : 'bulletList';

/** List item containing `node`. */
export const closestListItem = (node: Node, root: HTMLElement): HTMLElement | null => closestTag(node, root, 'LI');

/** Kind of the list the node is in, or `null` outside lists. */
export const activeListKind = (root: HTMLElement, node: Node): ListKind | null => {
  const list = closestListItem(node, root)?.parentElement;
  return list && isList(list) ? listKind(list) : null;
};

/** Creates an empty list element of the given kind. */
const createList = (kind: ListKind): HTMLElement =>
  kind === 'orderedList'
    ? createElement('ol')
    : createElement('ul', kind === 'taskList' ? { 'data-type': 'taskList' } : {});

/** Creates a list item holding `content`; task items get their checkbox and body wrapper. */
const createItem = (kind: ListKind, content: Node[]): HTMLElement => {
  const item = createElement('li');
  if (kind === 'taskList') {
    item.setAttribute('data-checked', 'false');
    ensureTaskItem(item).append(...content);
  } else {
    item.append(...content);
  }
  return item;
};

/** Converts an item between the task-item structure and a plain list item. */
const convertItem = (item: HTMLElement, kind: ListKind) => {
  const isTask = item.getAttribute('data-type') === 'taskItem';
  if (kind === 'taskList' && !isTask) ensureTaskItem(item);
  if (kind === 'taskList' || !isTask) return;
  item.removeAttribute('data-type');
  item.removeAttribute('data-checked');
  item.querySelector(':scope > label')?.remove();
  const body = item.querySelector(':scope > div');
  if (body) unwrap(body);
};

/** Changes a list (and all its items) to another kind, returning the possibly renamed list element. */
const convertList = (list: HTMLElement, kind: ListKind): HTMLElement => {
  if (listKind(list) === kind) return list;
  const target = kind === 'orderedList' ? 'OL' : 'UL';
  const converted = list.tagName === target ? list : renameElement(list, target.toLowerCase());
  converted.removeAttribute('start');
  if (kind === 'taskList') converted.setAttribute('data-type', 'taskList');
  else converted.removeAttribute('data-type');
  for (const item of Array.from(converted.children) as HTMLElement[]) convertItem(item, kind);
  return converted;
};

/** Joins the list with same-kind neighbours, as office editors do. */
const joinNeighbours = (list: HTMLElement) => {
  const previous = list.previousElementSibling;
  let target = list;
  if (previous && isList(previous) && listKind(previous) === listKind(list)) {
    previous.append(...Array.from(list.children));
    list.remove();
    target = previous as HTMLElement;
  }
  const next = target.nextElementSibling;
  if (next && isList(next) && listKind(next) === listKind(target)) {
    target.append(...Array.from(next.children));
    next.remove();
  }
};

/**
 * Moves an item one level up. From a nested list it becomes an item of the outer list, taking the following
 * siblings as its own sub-list; from a top-level list its content becomes plain blocks between two list halves.
 */
export const liftListItem = (root: HTMLElement, item: HTMLElement): void => {
  const list = item.parentElement;
  if (!list || !isList(list)) return;
  const kind = listKind(list);
  const following: Element[] = [];
  for (let sibling = item.nextElementSibling; sibling; sibling = sibling.nextElementSibling) following.push(sibling);

  const container = containerOf(list, root);
  const outerItem =
    container.tagName === 'LI' ? container : container.tagName === 'DIV' ? container.parentElement : null;

  if (outerItem?.tagName === 'LI') {
    if (following.length) {
      const rest = createList(kind);
      rest.append(...following);
      listItemBody(item).append(rest);
    }
    outerItem.after(item);
    const outerList = outerItem.parentElement;
    if (outerList) convertItem(item, listKind(outerList));
  } else {
    if (following.length) {
      const rest = list.cloneNode(false) as HTMLElement;
      rest.removeAttribute('start');
      rest.append(...following);
      list.after(rest);
    }
    list.after(...Array.from(listItemBody(item).childNodes));
    item.remove();
  }
  if (!list.children.length) list.remove();
};

/**
 * Nests an item under its previous sibling, reusing a trailing sub-list of the same kind.
 * @returns whether the item could be nested (the first item cannot).
 */
const sinkListItem = (item: HTMLElement): boolean => {
  const previous = item.previousElementSibling as HTMLElement | null;
  const list = item.parentElement;
  if (!previous || !list) return false;
  const body = listItemBody(previous);
  let nested = body.lastElementChild as HTMLElement | null;
  if (!(nested && isList(nested) && listKind(nested) === listKind(list))) {
    nested = createList(listKind(list));
    body.append(nested);
  }
  nested.append(item);
  return true;
};

/** Distinct list items that contain selected text blocks, in document order. */
const selectedItems = (root: HTMLElement, range: Range): HTMLElement[] => {
  const items = textBlocksInRange(root, range).map(block => closestListItem(block, root));
  return [...new Set(items.filter((item): item is HTMLElement => item !== null))];
};

/**
 * Tab / Shift+Tab inside lists: nests or lifts every selected item.
 * @returns whether any item changed level.
 */
export const changeListIndent = (root: HTMLElement, range: Range, delta: 1 | -1): boolean => {
  const items = selectedItems(root, range);
  if (!items.length) return false;
  if (delta > 0) return items.map(item => sinkListItem(item)).some(Boolean);
  // Lifting from the last item keeps the earlier items' positions valid.
  for (const item of items.reverse()) liftListItem(root, item);
  return true;
};

/** Lifts the block out of every list it is nested in ("clear formatting"). */
export const liftOutOfLists = (root: HTMLElement, block: HTMLElement): void => {
  for (let item = closestListItem(block, root); item; item = closestListItem(block, root)) liftListItem(root, item);
};

/**
 * Toolbar list button: lifts the selection out when it is already in lists of this kind, converts lists of other
 * kinds, and otherwise wraps the selected blocks in a new list joined with same-kind neighbours.
 */
export const toggleList = (root: HTMLElement, range: Range, kind: ListKind): void => {
  const blocks = textBlocksInRange(root, range);
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last) return;
  const items = blocks.map(block => closestListItem(block, root));

  if (items.every(Boolean)) {
    const lists = [...new Set(items.map(item => item?.parentElement as HTMLElement))];
    if (lists.every(list => listKind(list) === kind)) {
      for (const item of [...new Set(items)].reverse()) if (item) liftListItem(root, item);
    } else {
      for (const list of lists) joinNeighbours(convertList(list, kind));
    }
    return;
  }

  let container = containerOf(first, root);
  while (container !== root && !container.contains(last)) container = containerOf(container, root);
  const start = childOf(container, first);
  const end = childOf(container, last);
  const nodes: Node[] = [];
  for (let node: Node | null = start; node; node = node === end ? null : node.nextSibling) nodes.push(node);

  const list = createList(kind);
  start.parentNode?.insertBefore(list, start);
  for (const node of nodes) {
    if (isList(node)) {
      const converted = convertList(node as HTMLElement, kind);
      list.append(...Array.from(converted.children));
      converted.remove();
    } else {
      list.append(createItem(kind, [node]));
    }
  }
  joinNeighbours(list);
};

/** Moves `rightBlock` and everything after it in the item body into a new item placed after `item`. */
export const splitListItem = (item: HTMLElement, rightBlock: HTMLElement): HTMLElement => {
  const list = item.parentElement as HTMLElement;
  const body = listItemBody(item);
  const moving: Node[] = [];
  for (let node: Node | null = childOf(body, rightBlock); node; node = node.nextSibling) moving.push(node);
  const next = createItem(listKind(list), moving);
  item.after(next);
  return next;
};

/** Flips a task item's checked state in both the `data-checked` attribute and its checkbox. */
export const toggleTaskItem = (item: HTMLElement): void => {
  const checked = item.getAttribute('data-checked') !== 'true';
  item.setAttribute('data-checked', String(checked));
  const input = item.querySelector<HTMLInputElement>(':scope > label input');
  if (!input) return;
  input.checked = checked;
  input.toggleAttribute('checked', checked);
};
