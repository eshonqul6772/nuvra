/**
 * The document model of the editor: which HTML is allowed, how untrusted HTML (pasted from Word, Google Docs or the
 * web, or loaded from the server) is converted into it, how the live DOM is kept well-formed, and how the editable
 * DOM is turned back into clean HTML.
 */
import {
  FOOTNOTE_ATTRIBUTE,
  FOOTNOTE_SELECTOR,
  INLINE_ATOM_SELECTOR,
  TRAILING_BREAK,
  VARIABLE_ATTRIBUTE,
  VARIABLE_SELECTOR,
  createElement,
  createFootnote,
  createParagraph,
  createTrailingBreak,
  createVariable,
  hasVisibleContent,
  isBreak,
  isElement,
  isList,
  isText,
  isTrailingBreak,
  mergeAdjacentMarks,
  removeEmptyMarks,
  syncTrailingBreak,
  unwrap
} from './dom';
import { CHANGE_ATTRIBUTE, CHANGE_ID, COMMENT_ATTRIBUTE, COMMENT_ID, COMMENT_SELECTOR } from './marks';

/** Longest author name kept on a tracked change. */
const MAX_AUTHOR_LENGTH = 100;

/** A tracked change time as written by the editor or Word (ISO 8601). */
const CHANGE_TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;

/** A valid template variable name: letters, digits, `_`, `.` and `-`, as used in `{{name}}`. */
export const VARIABLE_NAME = /^[\p{L}\p{N}_.-]{1,64}$/u;

/** Attribute holding the label a variable chip shows in the editor; editor-only. */
export const VARIABLE_LABEL_ATTRIBUTE = 'data-label';

/** Table kinds kept from loaded or pasted content; signature tables and the table of contents have no borders. */
const TABLE_TYPES = new Set(['signature', 'toc']);

/** Attribute pagination writes on blocks it moved to the next sheet; editor-only. */
export const GAP_ATTRIBUTE = 'data-doc-gap';

/** Class marking table cells in a drag selection; editor-only. */
export const SELECTED_CELL_CLASS = 'doc-cell-selected';

/** Attribute holding the space a paragraph keeps before it, in points. */
export const SPACE_BEFORE_ATTRIBUTE = 'data-space-before';

/** Attribute holding the space a paragraph keeps after it, in points. */
export const SPACE_AFTER_ATTRIBUTE = 'data-space-after';

/** Largest paragraph spacing accepted from pasted content, in points. */
const MAX_SPACING_PT = 200;

/** Width of one paragraph indentation step. */
const INDENT_STEP_PX = 48;

/** Deepest paragraph indentation, in steps. */
const MAX_INDENT = 10;

/** Largest indent kept from loaded or pasted content, in pixels; the ruler uses the same limit. */
const MAX_INDENT_PX = 760;

/** CSS pixels per inch, the base of every absolute unit. */
const PX_PER_INCH = 96;

/** Centimetres per inch. */
const CM_PER_INCH = 2.54;

/** Millimetres per inch. */
const MM_PER_INCH = 25.4;

/** Points per CSS pixel. */
const PT_PER_PX = 0.75;

/** Font sizes are rounded to half points. */
const HALF_POINTS_PER_POINT = 2;

/** Highest code point of the control characters and space that browsers ignore inside URL schemes. */
const LAST_IGNORED_URL_CODE = 32;

/** The DEL control character, also ignored inside URL schemes. */
const DELETE_CODE = 127;

/** Tags that are blocks in the editor model; every other element is inline content. */
const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'TABLE',
  'HR',
  'IMG',
  'DIV'
]);

/** Elements removed together with their content: scripts, embeds, media and form controls. */
const DROPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TITLE',
  'META',
  'LINK',
  'BASE',
  'HEAD',
  'IFRAME',
  'FRAME',
  'OBJECT',
  'EMBED',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'MATH',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'SELECT',
  'TEXTAREA',
  'BUTTON',
  'INPUT',
  'FORM'
]);

/** Text-holding elements without an editor equivalent, mapped to the block they become. */
const TEXT_LIKE_TAGS: Record<string, string> = { DT: 'p', DD: 'p', ADDRESS: 'p', FIGCAPTION: 'p' };

/** Table and list parts that are unwrapped when they appear outside their proper parent. */
const STRAY_WRAPPERS = new Set(['LI', 'TR', 'TD', 'TH', 'TBODY', 'THEAD', 'TFOOT', 'COLGROUP', 'COL']);

/** A URL that starts with a scheme; any scheme outside the allow lists is rejected. */
const UNSAFE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Background colours treated as "no highlight" when converting pasted inline styles. */
const NO_BACKGROUND = /^(transparent|initial|inherit|white|#fff(fff)?|rgba?\(255, 255, 255(, 1)?\))$/i;

/** Whether the node is a block in the editor model. */
export const isBlockNode = (node: Node | null | undefined): node is HTMLElement =>
  isElement(node) && BLOCK_TAGS.has(node.tagName);

/** Rounds an indentation level into the supported range; non-numbers become 0. */
const clampIndent = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_INDENT, Math.max(0, Math.round(value))) : 0;

/** Sets a paragraph's indentation level as `data-indent` plus the matching left margin, removing both at level 0. */
export const setIndent = (block: HTMLElement, indent: number): void => {
  const value = clampIndent(indent);
  if (value) {
    block.dataset.indent = String(value);
    block.style.marginLeft = `${value * INDENT_STEP_PX}px`;
  } else {
    delete block.dataset.indent;
    block.style.removeProperty('margin-left');
  }
  if (!block.getAttribute('style')) block.removeAttribute('style');
};

/**
 * Returns the trimmed URL when it is safe to put in a link (`http(s)`, `mailto`, `tel` or relative) or an image
 * (`http(s)`, `data:image`, `blob` or relative), otherwise `null`.
 */
export const sanitizeUrl = (value: string | null, image = false): string | null => {
  const url = value?.trim();
  if (!url) return null;
  // Browsers ignore control characters and spaces inside a scheme ("java\tscript:"), so they are removed first.
  const compact = Array.from(url)
    .filter(character => {
      const code = character.charCodeAt(0);
      return code > LAST_IGNORED_URL_CODE && code !== DELETE_CODE;
    })
    .join('')
    .toLowerCase();
  const allowed = image ? /^(https?:|data:image\/|blob:)/ : /^(https?:|mailto:|tel:)/;
  return allowed.test(compact) || !UNSAFE_SCHEME.test(compact) ? url : null;
};

/** Converts a CSS length in px, pt, cm, mm or in to pixels; unknown units give 0. */
const toPixels = (value: string): number => {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  if (value.endsWith('pt')) return number / PT_PER_PX;
  if (value.endsWith('cm')) return (number * PX_PER_INCH) / CM_PER_INCH;
  if (value.endsWith('mm')) return (number * PX_PER_INCH) / MM_PER_INCH;
  if (value.endsWith('in')) return number * PX_PER_INCH;
  return /^-?[\d.]+(px)?$/.test(value.trim()) ? number : 0;
};

/** Converts a pt or px font size into points rounded to half a point; other units give `null`. */
const toPoints = (value: string): string | null => {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const points = value.endsWith('pt') ? number : value.endsWith('px') ? number * PT_PER_PX : null;
  if (points === null) return null;
  return `${Math.round(points * HALF_POINTS_PER_POINT) / HALF_POINTS_PER_POINT}pt`;
};

/** Wraps nodes in a new element, or returns nothing when there are no nodes to wrap. */
const wrap = (tag: string, nodes: Node[], attributes: Record<string, string> = {}): Node[] =>
  nodes.length ? [createElement(tag as 'span', attributes, nodes)] : [];

/**
 * Copies the space a pasted paragraph keeps before and after it (Word and Google Docs write it as a margin) into the
 * editor's own spacing attributes, so pagination can tell it apart from the gaps it adds itself.
 */
const copyBlockSpacing = (source: HTMLElement, target: HTMLElement): void => {
  const sides = [
    {
      attribute: SPACE_BEFORE_ATTRIBUTE,
      property: 'margin-top',
      value: source.dataset.spaceBefore || toPoints(source.style.marginTop)
    },
    {
      attribute: SPACE_AFTER_ATTRIBUTE,
      property: 'margin-bottom',
      value: source.dataset.spaceAfter || toPoints(source.style.marginBottom)
    }
  ];
  for (const side of sides) {
    const points = Number.parseFloat(side.value ?? '');
    if (!Number.isFinite(points) || points <= 0 || points > MAX_SPACING_PT) continue;
    const rounded = Math.round(points * 2) / 2;
    target.setAttribute(side.attribute, String(rounded));
    target.style.setProperty(side.property, `${rounded}pt`);
  }
};

/**
 * Keeps the indents of a loaded or pasted paragraph as exact distances, so values dragged on the ruler survive a
 * round trip. A left indent that is a whole number of steps also keeps the attribute the indent buttons work with.
 */
const copyBlockIndents = (source: HTMLElement, target: HTMLElement): void => {
  const clampPx = (value: number) => Math.round(Math.min(MAX_INDENT_PX, Math.max(-MAX_INDENT_PX, value)));
  const steps = Number.parseInt(source.dataset.indent ?? '', 10);
  const left = clampPx(steps > 0 ? clampIndent(steps) * INDENT_STEP_PX : toPixels(source.style.marginLeft));
  if (left > 0) {
    if (left % INDENT_STEP_PX === 0) setIndent(target, left / INDENT_STEP_PX);
    else target.style.marginLeft = `${left}px`;
  }
  const right = clampPx(toPixels(source.style.marginRight));
  if (right > 0) target.style.marginRight = `${right}px`;
  const firstLine = clampPx(toPixels(source.style.textIndent));
  if (firstLine !== 0) target.style.textIndent = `${firstLine}px`;
};

/** Copies the paragraph formatting the editor supports: alignment, line height, indentation and direction. */
const copyBlockFormat = (source: HTMLElement, target: HTMLElement): void => {
  const align = source.style.textAlign || source.getAttribute('align') || '';
  if (['center', 'right', 'justify'].includes(align)) target.style.textAlign = align;
  const lineHeight = source.style.lineHeight;
  if (lineHeight && lineHeight !== 'normal' && !lineHeight.endsWith('%')) target.style.lineHeight = lineHeight;
  copyBlockIndents(source, target);
  const direction = source.getAttribute('dir');
  if (direction === 'ltr' || direction === 'rtl') target.setAttribute('dir', direction);
  copyBlockSpacing(source, target);
};

/** Turns presentational CSS (Word, Google Docs) into the editor's own marks around the converted content. */
const applyInlineStyles = (source: HTMLElement, content: Node[]): Node[] => {
  let nodes = content;
  if (!nodes.length) return nodes;
  const { style } = source;
  const weight = style.fontWeight;
  if (weight === 'bold' || Number(weight) >= 600) nodes = wrap('strong', nodes);
  if (style.fontStyle === 'italic') nodes = wrap('em', nodes);
  const decoration = `${style.textDecorationLine} ${style.textDecoration}`;
  if (decoration.includes('underline')) nodes = wrap('u', nodes);
  if (decoration.includes('line-through')) nodes = wrap('s', nodes);
  if (style.verticalAlign === 'super') nodes = wrap('sup', nodes);
  if (style.verticalAlign === 'sub') nodes = wrap('sub', nodes);

  const spanStyles: string[] = [];
  const color = style.color || source.getAttribute('color');
  if (color && !/^(inherit|initial|windowtext)$/i.test(color)) spanStyles.push(`color: ${color}`);
  const family = style.fontFamily || source.getAttribute('face');
  if (family && !/^(inherit|initial)$/i.test(family)) spanStyles.push(`font-family: ${family}`);
  const size = toPoints(style.fontSize);
  if (size) spanStyles.push(`font-size: ${size}`);
  if (spanStyles.length) nodes = wrap('span', nodes, { style: spanStyles.join('; ') });

  const background = style.backgroundColor;
  if (background && !NO_BACKGROUND.test(background)) {
    nodes = wrap('mark', nodes, { 'data-color': background, style: `background-color: ${background}; color: inherit` });
  }
  return nodes;
};

/** Converts every child of `source`; `preformatted` keeps whitespace as typed. */
const convertChildren = (source: Node, preformatted = false): Node[] =>
  Array.from(source.childNodes).flatMap(child => convertNode(child, preformatted));

/** Rebuilds an image with a safe `src`, its size, alt text and alignment; unsafe images are dropped. */
const convertImage = (source: HTMLElement): Node[] => {
  const src = sanitizeUrl(source.getAttribute('src'), true);
  if (!src) return [];
  const image = createElement('img', { src });
  for (const name of ['alt', 'title']) {
    const value = source.getAttribute(name);
    if (value) image.setAttribute(name, value);
  }
  for (const name of ['width', 'height'] as const) {
    const value = Number.parseInt(source.getAttribute(name) ?? source.style[name] ?? '', 10);
    if (value > 0) image.setAttribute(name, String(value));
  }
  const align = source.getAttribute('data-align');
  image.setAttribute('data-align', align === 'left' || align === 'right' ? align : 'center');
  return [image];
};

/** Rebuilds a table row by row, keeping cell spans, header cells and pixel column widths. */
const convertTable = (source: HTMLTableElement): HTMLElement => {
  const table = createElement('table');
  const type = source.getAttribute('data-type');
  if (type && TABLE_TYPES.has(type)) table.setAttribute('data-type', type);
  const widths = Array.from(source.querySelectorAll<HTMLElement>(':scope > colgroup > col, :scope > col')).map(col =>
    toPixels(col.style.width || col.getAttribute('width') || '')
  );
  if (widths.length && widths.every(width => width > 0)) {
    const cols = widths.map(width => createElement('col', { style: `width: ${Math.round(width)}px` }));
    table.append(createElement('colgroup', {}, cols));
    table.style.width = `${Math.round(widths.reduce((sum, width) => sum + width, 0))}px`;
  }
  const body = createElement('tbody');
  for (const row of Array.from(source.rows)) {
    const tr = createElement('tr');
    for (const cell of Array.from(row.cells)) {
      const next = createElement(cell.tagName === 'TH' ? 'th' : 'td', {}, convertChildren(cell));
      if (cell.colSpan > 1) next.setAttribute('colspan', String(cell.colSpan));
      if (cell.rowSpan > 1) next.setAttribute('rowspan', String(cell.rowSpan));
      tr.append(next);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
};

/** Converts a task list item, taking its content from the `<div>` body and skipping the checkbox label. */
const convertTaskItem = (source: HTMLElement): HTMLElement => {
  const body = source.querySelector(':scope > div');
  const nodes = body
    ? convertChildren(body)
    : Array.from(source.childNodes)
        .filter(node => !(isElement(node) && node.tagName === 'LABEL'))
        .flatMap(node => convertNode(node, false));
  const checked = String(source.getAttribute('data-checked') === 'true');
  return createElement('li', { 'data-type': 'taskItem', 'data-checked': checked }, nodes);
};

/**
 * Converts one untrusted node into editor nodes. Supported elements are rebuilt from scratch (so no foreign
 * attribute or event handler survives), unsupported ones are replaced by their converted content.
 */
const convertNode = (source: Node, preformatted: boolean): Node[] => {
  if (isText(source)) {
    const data = preformatted ? source.data : source.data.replace(/[\t\n\r ]+/g, ' ');
    return data ? [document.createTextNode(data)] : [];
  }
  if (!isElement(source)) return [];
  const tag = source.tagName.toUpperCase();
  if (DROPPED_TAGS.has(tag)) return [];
  const content = () => convertChildren(source);
  const variable = tag === 'SPAN' ? source.getAttribute(VARIABLE_ATTRIBUTE)?.trim() : undefined;
  if (variable && VARIABLE_NAME.test(variable)) return applyInlineStyles(source, [createVariable(variable)]);
  const footnote = tag === 'SUP' ? source.getAttribute(FOOTNOTE_ATTRIBUTE)?.trim() : undefined;
  if (footnote !== undefined) return [createFootnote(footnote)];
  const comment = tag === 'SPAN' ? source.getAttribute(COMMENT_ATTRIBUTE)?.trim() : undefined;
  if (comment && COMMENT_ID.test(comment)) {
    return wrap('span', applyInlineStyles(source, content()), { [COMMENT_ATTRIBUTE]: comment });
  }

  switch (tag) {
    case 'P':
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
    case 'DT':
    case 'DD':
    case 'ADDRESS':
    case 'FIGCAPTION': {
      const block = createElement((TEXT_LIKE_TAGS[tag] ?? tag.toLowerCase()) as 'p', {}, content());
      copyBlockFormat(source, block);
      return [block];
    }
    case 'DIV': {
      if (source.getAttribute('data-type') === 'page-break') {
        return [createElement('div', { 'data-type': 'page-break', class: 'doc-page-break' })];
      }
      const nodes = content();
      if (nodes.some(isBlockNode)) return nodes;
      const block = createElement('p', {}, nodes);
      copyBlockFormat(source, block);
      return nodes.length ? [block] : [];
    }
    case 'BLOCKQUOTE':
      return [createElement('blockquote', {}, content())];
    case 'PRE':
      return [createElement('pre', {}, [createElement('code', {}, [source.textContent ?? ''])])];
    case 'UL':
    case 'OL': {
      const task = source.getAttribute('data-type') === 'taskList';
      const list = createElement(tag === 'OL' ? 'ol' : 'ul', task ? { 'data-type': 'taskList' } : {}, content());
      const start = Number.parseInt(source.getAttribute('start') ?? '', 10);
      if (tag === 'OL' && start > 1) list.setAttribute('start', String(start));
      if (tag === 'OL' && source.getAttribute('data-numbering') === 'legal')
        list.setAttribute('data-numbering', 'legal');
      return [list];
    }
    case 'LI':
      return [
        source.getAttribute('data-type') === 'taskItem' ? convertTaskItem(source) : createElement('li', {}, content())
      ];
    case 'TABLE':
      return [convertTable(source as HTMLTableElement)];
    case 'HR':
      return [createElement('hr')];
    case 'IMG':
      return convertImage(source);
    case 'BR':
      return [createElement('br')];
    case 'A': {
      const href = sanitizeUrl(source.getAttribute('href'));
      const nodes = applyInlineStyles(source, content());
      if (!href) return nodes;
      const attributes: Record<string, string> = { href, rel: 'noopener noreferrer nofollow' };
      if (source.getAttribute('target') === '_blank') attributes.target = '_blank';
      return wrap('a', nodes, attributes);
    }
    case 'STRONG':
    case 'B':
      // Google Docs wraps whole documents in <b style="font-weight: normal">.
      return /^(normal|400)$/.test(source.style.fontWeight)
        ? applyInlineStyles(source, content())
        : wrap('strong', applyInlineStyles(source, content()));
    case 'EM':
    case 'I':
    case 'CITE':
    case 'DFN':
    case 'VAR':
      return wrap('em', applyInlineStyles(source, content()));
    case 'INS':
    case 'DEL': {
      // Tracked changes keep their element and who made them; other insertions and deletions are just formatting.
      const change = source.getAttribute(CHANGE_ATTRIBUTE)?.trim();
      if (change && CHANGE_ID.test(change)) {
        const time = source.getAttribute('data-time') ?? '';
        return wrap(tag.toLowerCase(), applyInlineStyles(source, content()), {
          [CHANGE_ATTRIBUTE]: change,
          'data-author': (source.getAttribute('data-author') ?? '').slice(0, MAX_AUTHOR_LENGTH),
          'data-time': CHANGE_TIME.test(time) ? time : ''
        });
      }
      return wrap(tag === 'INS' ? 'u' : 's', applyInlineStyles(source, content()));
    }
    case 'U':
      return wrap('u', applyInlineStyles(source, content()));
    case 'S':
    case 'STRIKE':
      return wrap('s', applyInlineStyles(source, content()));
    case 'CODE':
    case 'KBD':
    case 'SAMP':
    case 'TT':
      return wrap('code', [document.createTextNode(source.textContent ?? '')]);
    case 'SUB':
    case 'SUP':
      return wrap(tag.toLowerCase(), applyInlineStyles(source, content()));
    case 'MARK': {
      const color = source.getAttribute('data-color') || source.style.backgroundColor;
      const attributes: Record<string, string> = color
        ? { 'data-color': color, style: `background-color: ${color}; color: inherit` }
        : {};
      return wrap('mark', content(), attributes);
    }
    default:
      return applyInlineStyles(source, content());
  }
};

// ---------------------------------------------------------------------------------------------------------------
// Structure normalisation

/** The element holding a list item's blocks: the `<div>` of a task item, the `<li>` itself otherwise. */
export const listItemBody = (item: HTMLElement): HTMLElement =>
  item.getAttribute('data-type') === 'taskItem' ? (item.querySelector<HTMLElement>(':scope > div') ?? item) : item;

/**
 * Gives a list item the task structure (non-editable checkbox label plus `<div>` body) with the checkbox mirroring
 * `data-checked`, moves any stray content into the body and returns the body.
 */
export const ensureTaskItem = (item: HTMLElement): HTMLElement => {
  const checked = item.getAttribute('data-checked') === 'true';
  item.setAttribute('data-type', 'taskItem');
  item.setAttribute('data-checked', String(checked));
  let label = item.querySelector<HTMLElement>(':scope > label');
  if (!label) {
    label = createElement('label', {}, [createElement('input', { type: 'checkbox' }), createElement('span')]);
    item.prepend(label);
  }
  label.setAttribute('contenteditable', 'false');
  const input = label.querySelector('input') ?? label.appendChild(createElement('input', { type: 'checkbox' }));
  input.checked = checked;
  input.toggleAttribute('checked', checked);
  let body = item.querySelector<HTMLElement>(':scope > div');
  if (!body) {
    body = createElement('div');
    item.append(body);
  }
  for (const node of Array.from(item.childNodes)) if (node !== label && node !== body) body.append(node);
  return body;
};

/** Strips the task structure from a list item that now belongs to a bullet or numbered list. */
const toPlainListItem = (item: HTMLElement): void => {
  item.removeAttribute('data-type');
  item.removeAttribute('data-checked');
  item.querySelector(':scope > label')?.remove();
  const body = item.querySelector(':scope > div');
  if (body) unwrap(body);
};

/** Makes every child of a list an item of the list's kind; nested lists join the previous item. */
const normalizeList = (list: HTMLElement): void => {
  const task = list.getAttribute('data-type') === 'taskList';
  for (const child of Array.from(list.childNodes)) {
    if (isElement(child) && child.tagName === 'LI') continue;
    if (isText(child) && child.data.trim() === '') {
      child.remove();
    } else if (isList(child) && isElement(child.previousSibling) && child.previousSibling.tagName === 'LI') {
      listItemBody(child.previousSibling).append(child);
    } else {
      const item = createElement('li');
      child.replaceWith(item);
      item.append(child);
    }
  }
  for (const item of Array.from(list.children) as HTMLElement[]) {
    if (task) ensureTaskItem(item);
    else toPlainListItem(item);
    normalizeContainer(listItemBody(item));
  }
  if (!list.children.length) list.remove();
};

/** Collects all rows into a single `<tbody>`, drops non-cell children and removes tables left without rows. */
const normalizeTable = (table: HTMLElement): void => {
  const rows = Array.from(
    table.querySelectorAll<HTMLElement>(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')
  );
  const colgroup = table.querySelector(':scope > colgroup');
  const body = createElement('tbody', {}, rows);
  table.replaceChildren(...(colgroup ? [colgroup] : []), body);
  for (const row of rows) {
    for (const child of Array.from(row.childNodes)) {
      if (!(isElement(child) && (child.tagName === 'TD' || child.tagName === 'TH'))) child.remove();
    }
    if (!row.children.length) row.remove();
    for (const cell of Array.from(row.children) as HTMLElement[]) normalizeContainer(cell);
  }
  if (!body.children.length) table.remove();
};

/**
 * Keeps a code block as `<pre><code>text</code></pre>` and adds a placeholder break when it is empty or ends with a
 * newline, so the last line stays visible.
 */
const normalizePre = (pre: HTMLElement): void => {
  const code = pre.firstElementChild;
  const valid =
    pre.childNodes.length === 1 &&
    code?.tagName === 'CODE' &&
    Array.from(code.childNodes).every(node => isText(node) || isTrailingBreak(node));
  const text = pre.textContent ?? '';
  const target = valid && code ? (code as HTMLElement) : createElement('code', {}, [text]);
  if (!valid) pre.replaceChildren(target);
  const trailing = Array.from(target.childNodes).find(isTrailingBreak);
  const needsBreak = text === '' || text.endsWith('\n');
  if (needsBreak && !trailing) target.append(createTrailingBreak());
  if (!needsBreak && trailing) trailing.remove();
};

/** Moves an image out of a paragraph, splitting the paragraph around it; returns the right-hand part. */
const splitAroundImage = (block: HTMLElement, image: HTMLElement): HTMLElement => {
  const range = document.createRange();
  range.setStartBefore(image);
  range.setEnd(block, block.childNodes.length);
  const tail = range.extractContents();
  tail.querySelector('img')?.remove();
  const right = block.cloneNode(false) as HTMLElement;
  right.append(tail);
  block.after(image, right);
  for (const part of [block, right]) if (!hasVisibleContent(part)) part.remove();
  return right;
};

/**
 * Keeps a paragraph or heading inline-only: nested text blocks are unwrapped, other blocks and images move out,
 * empty marks are removed, equal marks merged and the placeholder break synchronised.
 */
const normalizeTextBlock = (block: HTMLElement): void => {
  for (const child of Array.from(block.children) as HTMLElement[]) {
    if (!isBlockNode(child) || child.tagName === 'IMG') continue;
    if (/^(P|H[1-6])$/.test(child.tagName)) unwrap(child);
    else block.after(child);
  }
  const image = block.querySelector<HTMLElement>('img');
  if (image) {
    const right = splitAroundImage(block, image);
    if (right.isConnected) normalizeTextBlock(right);
    if (!block.isConnected) return;
  }
  // Variable chips and footnote references are atoms: nothing typed or pasted may end up inside them.
  for (const chip of Array.from(block.querySelectorAll<HTMLElement>(INLINE_ATOM_SELECTOR))) {
    if (chip.firstChild) chip.replaceChildren();
    if (chip.getAttribute('contenteditable') !== 'false') chip.setAttribute('contenteditable', 'false');
    const className = chip.tagName === 'SUP' ? 'doc-footnote' : 'doc-variable';
    if (!chip.classList.contains(className)) chip.classList.add(className);
  }
  removeEmptyMarks(block);
  mergeAdjacentMarks(block);
  syncTrailingBreak(block);
};

/** Normalises one block according to its kind. */
const normalizeBlock = (block: HTMLElement): void => {
  switch (block.tagName) {
    case 'PRE':
      normalizePre(block);
      break;
    case 'BLOCKQUOTE':
      normalizeContainer(block);
      break;
    case 'UL':
    case 'OL':
      normalizeList(block);
      break;
    case 'TABLE':
      normalizeTable(block);
      break;
    case 'IMG':
    case 'HR':
      break;
    case 'DIV':
      block.replaceChildren();
      block.className = 'doc-page-break';
      break;
    default:
      normalizeTextBlock(block);
  }
};

/** Whether a direct child of a block container is a wrapper that must be unwrapped. */
const isStrayWrapper = (node: Node): node is HTMLElement =>
  isElement(node) &&
  (STRAY_WRAPPERS.has(node.tagName) || (node.tagName === 'DIV' && node.getAttribute('data-type') !== 'page-break'));

/**
 * Makes a block container (document, quote, list item body, table cell) hold only well-formed blocks: stray wrappers
 * are unwrapped, runs of inline content become paragraphs and every block is normalised. The document root also
 * always ends with a paragraph, so the caret can be placed after tables, images and rules.
 */
export const normalizeContainer = (container: ParentNode & Node, isRoot = false): void => {
  let unwrapped = true;
  while (unwrapped) {
    unwrapped = false;
    for (const child of Array.from(container.childNodes)) {
      if (!isStrayWrapper(child)) continue;
      unwrap(child);
      unwrapped = true;
    }
  }

  let run: Node[] = [];
  /** Wraps the pending inline run into a paragraph before `before`, or drops it when it shows nothing. */
  const flush = (before: Node | null) => {
    if (!run.length) return;
    const visible = run.some(node =>
      isText(node) ? node.data.trim() !== '' : isElement(node) && (isBreak(node) || hasVisibleContent(node))
    );
    if (visible) container.insertBefore(createParagraph(run), before);
    else for (const node of run) node.parentNode?.removeChild(node);
    run = [];
  };

  for (const child of Array.from(container.childNodes)) {
    if (isBlockNode(child)) {
      flush(child);
      normalizeBlock(child);
    } else {
      run.push(child);
    }
  }
  flush(null);

  // Paragraphs created from runs may still hold images or nested blocks.
  for (const child of Array.from(container.childNodes)) {
    if (isElement(child) && child.tagName === 'P' && child.querySelector('img, p, ul, ol, table')) {
      normalizeTextBlock(child);
    }
  }
  if (!container.firstChild) container.appendChild(createParagraph());
  if (isRoot && !(isElement(container.lastChild) && container.lastChild.tagName === 'P')) {
    container.appendChild(createParagraph());
  }
};

/** Parses untrusted HTML without executing it and returns editor-ready blocks. */
export const sanitizeHtml = (html: string): DocumentFragment => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  fragment.append(...convertChildren(parsed.body));
  normalizeContainer(fragment);
  return fragment;
};

/**
 * Removes editor-only markup (pagination gaps, cell selection). With `forExport` it also drops caret placeholders
 * and editing attributes, which history snapshots keep so the restored DOM is immediately editable, and numbers the
 * footnote references from `firstFootnote` (a sheet of a longer document continues the numbering).
 */
export const cleanEditorArtifacts = (
  scope: Element | DocumentFragment,
  forExport: boolean,
  firstFootnote = 1
): void => {
  for (const element of Array.from(scope.querySelectorAll<HTMLElement>(`[${GAP_ATTRIBUTE}]`))) {
    // The paragraph's own space before it survives; only the gap pagination added is taken back.
    const own = element.getAttribute(SPACE_BEFORE_ATTRIBUTE);
    if (own) element.style.marginTop = `${own}pt`;
    else element.style.removeProperty('margin-top');
    element.removeAttribute(GAP_ATTRIBUTE);
    if (!element.getAttribute('style')) element.removeAttribute('style');
  }
  for (const element of Array.from(scope.querySelectorAll(`.${SELECTED_CELL_CLASS}`))) {
    element.classList.remove(SELECTED_CELL_CLASS);
    if (!element.classList.length) element.removeAttribute('class');
  }
  if (!forExport) return;
  // The editor marks resolved and active comments with classes; saved HTML keeps only the anchor.
  for (const anchor of Array.from(scope.querySelectorAll(COMMENT_SELECTOR))) anchor.removeAttribute('class');
  for (const br of Array.from(scope.querySelectorAll(`br[${TRAILING_BREAK}]`))) br.remove();
  for (const label of Array.from(scope.querySelectorAll('label[contenteditable]'))) {
    label.removeAttribute('contenteditable');
  }
  // Outside the editor a variable is plain `{{name}}` text, so servers can fill it with a simple replacement.
  for (const chip of Array.from(scope.querySelectorAll<HTMLElement>(VARIABLE_SELECTOR))) {
    for (const name of ['contenteditable', 'class', VARIABLE_LABEL_ATTRIBUTE]) chip.removeAttribute(name);
    chip.textContent = `{{${chip.getAttribute(VARIABLE_ATTRIBUTE)}}}`;
  }
  // A footnote reference carries its number, so the saved document reads correctly without the editor.
  Array.from(scope.querySelectorAll<HTMLElement>(FOOTNOTE_SELECTOR)).forEach((reference, index) => {
    for (const name of ['contenteditable', 'class']) reference.removeAttribute(name);
    reference.textContent = String(firstFootnote + index);
  });
};

/** Clean HTML of the editor content, as stored in the model and exported. */
export const serialize = (root: HTMLElement): string => {
  const clone = root.cloneNode(true) as HTMLElement;
  cleanEditorArtifacts(clone, true);
  return clone.innerHTML;
};

/** Whether the document is a single unformatted, empty paragraph. */
export const isEmptyDocument = (root: HTMLElement): boolean => {
  const only = root.firstElementChild;
  return (
    root.childElementCount === 1 &&
    only?.tagName === 'P' &&
    !only.hasAttribute('style') &&
    (only.textContent ?? '') === '' &&
    only.querySelector(`img, ${INLINE_ATOM_SELECTOR}, br:not([${TRAILING_BREAK}])`) === null
  );
};
