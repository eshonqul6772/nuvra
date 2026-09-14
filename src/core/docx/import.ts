/**
 * Reads a Word document (`.docx`) into editor HTML: paragraphs and headings with alignment, indents and spacing,
 * character formatting, links, lists, tables with merged cells, images, page breaks, the page setup and the header
 * and footer texts. The result still passes through the editor's sanitiser.
 */
import { MARGIN_PRESETS, PAGE_SIZES, type PageHeaderFooter, type PageSettings, type PageSizeKey } from '../page';
import { readZip } from './zip';

/** What was read from a Word document. */
export interface DocxImport {
  /** Document content as HTML. */
  html: string;
  /** Page setup of the document's last section. */
  page: PageSettings;
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const TWIPS_PER_PX = 15;
const TWIPS_PER_MM = 1440 / 25.4;
const EMU_PER_PX = 9525;
const LINE_UNIT = 240;
/** Marks a page break inside a paragraph's HTML until the paragraph is split there. */
const PAGE_BREAK_MARK = '\u0000';
/** Paper sizes that differ by less than this many millimetres count as the same format. */
const PAPER_TOLERANCE_MM = 2;

/** Word's named highlight colours. */
const HIGHLIGHTS: Record<string, string> = {
  yellow: '#fef08a',
  green: '#bbf7d0',
  cyan: '#a5f3fc',
  magenta: '#f5d0fe',
  blue: '#bfdbfe',
  red: '#fecaca',
  darkBlue: '#1e3a8a',
  darkCyan: '#0e7490',
  darkGreen: '#166534',
  darkMagenta: '#86198f',
  darkRed: '#991b1b',
  darkYellow: '#a16207',
  darkGray: '#4b5563',
  lightGray: '#e5e7eb',
  black: '#000000'
};

/** MIME types of images by file extension. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml'
};

/** Escapes text for HTML. */
const html = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character
  );

/** Child elements of a WordprocessingML element with the given local name. */
const children = (element: Element | null | undefined, name?: string): Element[] =>
  Array.from(element?.children ?? []).filter(child => !name || child.localName === name);

/** Descendant elements with the given local name, whatever their namespace prefix. */
const descendants = (root: Element | Document | null | undefined, name: string): Element[] =>
  Array.from(root?.getElementsByTagName('*') ?? []).filter(element => element.localName === name);

/** First child element with the given local name. */
const child = (element: Element | null | undefined, name: string): Element | null => children(element, name)[0] ?? null;

/** A `w:` attribute value. */
const attr = (element: Element | null | undefined, name: string): string | null =>
  element?.getAttributeNS(NS_W, name) ?? element?.getAttribute(`w:${name}`) ?? null;

/** Whether an on/off property such as `w:b` is switched on. */
const isOn = (element: Element | null): boolean => {
  if (!element) return false;
  const value = attr(element, 'val');
  return value === null || !['0', 'false', 'off', 'none'].includes(value);
};

/** Parses an XML part, or returns `null` when the package does not have it. */
const parsePart = (files: Map<string, Uint8Array>, name: string): Document | null => {
  const data = files.get(name);
  return data ? new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml') : null;
};

/** Base64 of binary data, in chunks so large images do not overflow the call stack. */
const toBase64 = (data: Uint8Array): string => {
  let binary = '';
  const chunk = 0x80_00;
  for (let index = 0; index < data.length; index += chunk) {
    binary += String.fromCharCode(...data.subarray(index, index + chunk));
  }
  return btoa(binary);
};

/** Numbering format of a list level. */
interface ListLevel {
  ordered: boolean;
  legal: boolean;
}

/** A paragraph that belongs to a list, waiting to be grouped with its neighbours. */
interface ListParagraph {
  numId: string;
  level: number;
  content: string;
  format: ListLevel;
}

/** Converts the parts of one package. */
class DocxReader {
  private readonly relationships = new Map<string, { target: string; external: boolean }>();
  private readonly headingStyles = new Map<string, number>();
  private readonly numbering = new Map<string, Map<number, ListLevel>>();
  /** Plain texts of the footnotes, by id. */
  private readonly footnotes = new Map<string, string>();

  constructor(private readonly files: Map<string, Uint8Array>) {
    const rels = parsePart(files, 'word/_rels/document.xml.rels');
    for (const relationship of Array.from(rels?.getElementsByTagName('Relationship') ?? [])) {
      this.relationships.set(relationship.getAttribute('Id') ?? '', {
        target: relationship.getAttribute('Target') ?? '',
        external: relationship.getAttribute('TargetMode') === 'External'
      });
    }
    this.readStyles();
    this.readNumbering();
    this.readFootnotes();
  }

  /** Texts of the footnotes; the separators Word keeps in the same part have no text and are skipped. */
  private readFootnotes() {
    const part = parsePart(this.files, 'word/footnotes.xml');
    for (const footnote of descendants(part, 'footnote')) {
      const type = attr(footnote, 'type');
      if (type && type !== 'normal') continue;
      const text = children(footnote, 'p')
        .map(paragraph =>
          descendants(paragraph, 't')
            .map(node => node.textContent ?? '')
            .join('')
        )
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      this.footnotes.set(attr(footnote, 'id') ?? '', text);
    }
  }

  /** Paragraph styles that are headings: `Heading1`…`Heading6`, `Title`, or styles with an outline level. */
  private readStyles() {
    const styles = parsePart(this.files, 'word/styles.xml');
    for (const style of descendants(styles, 'style')) {
      const id = attr(style, 'styleId') ?? '';
      const name = attr(child(style, 'name'), 'val')?.toLowerCase() ?? '';
      const outline = attr(child(child(style, 'pPr'), 'outlineLvl'), 'val');
      const level =
        Number(/^heading\s?(\d)$/i.exec(id)?.[1] ?? /^heading (\d)$/.exec(name)?.[1] ?? '') ||
        (id === 'Title' || name === 'title' ? 1 : outline !== null ? Number(outline) + 1 : 0);
      if (level >= 1 && level <= 6) this.headingStyles.set(id, level);
    }
  }

  /** List formats per numbering instance and level. */
  private readNumbering() {
    const numbering = parsePart(this.files, 'word/numbering.xml');
    if (!numbering) return;
    const abstracts = new Map<string, Map<number, ListLevel>>();
    for (const abstract of descendants(numbering, 'abstractNum')) {
      const levels = new Map<number, ListLevel>();
      const definitions = children(abstract, 'lvl');
      // The top level reads `%1.` either way; a list is legal when its deeper levels repeat the parent numbers.
      const legal = definitions.some(
        level => /%\d\.%\d/.test(attr(child(level, 'lvlText'), 'val') ?? '') || isOn(child(level, 'isLgl'))
      );
      for (const level of definitions) {
        const format = attr(child(level, 'numFmt'), 'val') ?? 'decimal';
        levels.set(Number(attr(level, 'ilvl') ?? 0), { ordered: format !== 'bullet' && format !== 'none', legal });
      }
      abstracts.set(attr(abstract, 'abstractNumId') ?? '', levels);
    }
    for (const instance of descendants(numbering, 'num')) {
      const abstractId = attr(child(instance, 'abstractNumId'), 'val') ?? '';
      this.numbering.set(attr(instance, 'numId') ?? '', abstracts.get(abstractId) ?? new Map());
    }
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Runs

  /** Inline CSS and wrapping tags of a run's properties. */
  private runWrap(properties: Element | null, content: string): string {
    if (!properties || !content) return content;
    let result = content;
    const styles: string[] = [];
    const color = attr(child(properties, 'color'), 'val');
    if (color && color !== 'auto' && /^[\da-f]{6}$/i.test(color)) styles.push(`color: #${color.toLowerCase()}`);
    const size = Number(attr(child(properties, 'sz'), 'val'));
    if (size > 0) styles.push(`font-size: ${size / 2}pt`);
    const font = attr(child(properties, 'rFonts'), 'ascii') ?? attr(child(properties, 'rFonts'), 'hAnsi');
    if (font) styles.push(`font-family: ${font.includes(' ') ? `'${font}'` : font}`);
    if (styles.length) result = `<span style="${html(styles.join('; '))}">${result}</span>`;
    if (isOn(child(properties, 'b'))) result = `<strong>${result}</strong>`;
    if (isOn(child(properties, 'i'))) result = `<em>${result}</em>`;
    const underline = child(properties, 'u');
    if (underline && attr(underline, 'val') !== 'none') result = `<u>${result}</u>`;
    if (isOn(child(properties, 'strike')) || isOn(child(properties, 'dstrike'))) result = `<s>${result}</s>`;
    const vertical = attr(child(properties, 'vertAlign'), 'val');
    if (vertical === 'superscript') result = `<sup>${result}</sup>`;
    if (vertical === 'subscript') result = `<sub>${result}</sub>`;
    const highlight = HIGHLIGHTS[attr(child(properties, 'highlight'), 'val') ?? ''];
    const fill = attr(child(properties, 'shd'), 'fill');
    const background =
      highlight ??
      (fill && /^[\da-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF' ? `#${fill.toLowerCase()}` : null);
    if (background)
      result = `<mark data-color="${background}" style="background-color: ${background}; color: inherit">${result}</mark>`;
    return result;
  }

  /** An inline image from a drawing, as a data URL. */
  private drawing(drawing: Element): string {
    const blip = descendants(drawing, 'blip')[0];
    const id = blip?.getAttributeNS(NS_R, 'embed') ?? blip?.getAttribute('r:embed') ?? '';
    const target = this.relationships.get(id)?.target ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
    const data = this.files.get(path);
    const type = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
    if (!data || !type) return '';
    const extent = descendants(drawing, 'extent')[0];
    const width = Math.round(Number(extent?.getAttribute('cx') ?? 0) / EMU_PER_PX);
    const height = Math.round(Number(extent?.getAttribute('cy') ?? 0) / EMU_PER_PX);
    const size = width > 0 && height > 0 ? ` width="${width}" height="${height}"` : '';
    const description = descendants(drawing, 'docPr')[0]?.getAttribute('descr') ?? '';
    return `<img src="data:${type};base64,${toBase64(data)}" alt="${html(description)}"${size}>`;
  }

  /** HTML of a paragraph's inline content; page breaks inside it are written as {@link PAGE_BREAK_MARK}. */
  private inline(container: Element): string {
    const parts: string[] = [];
    for (const node of children(container)) {
      switch (node.localName) {
        case 'r': {
          const properties = child(node, 'rPr');
          let text = '';
          const flush = () => {
            if (text) parts.push(this.runWrap(properties, text));
            text = '';
          };
          for (const piece of children(node)) {
            if (piece.localName === 't' || piece.localName === 'delText') text += html(piece.textContent ?? '');
            else if (piece.localName === 'tab') text += '\t';
            else if (piece.localName === 'noBreakHyphen') text += '‑';
            else if (piece.localName === 'br' || piece.localName === 'cr') {
              if (attr(piece, 'type') === 'page') {
                flush();
                parts.push(PAGE_BREAK_MARK);
              } else {
                text += '<br>';
              }
            } else if (piece.localName === 'footnoteReference') {
              flush();
              const note = this.footnotes.get(attr(piece, 'id') ?? '');
              if (note !== undefined) parts.push(`<sup data-footnote="${html(note)}"></sup>`);
            } else if (piece.localName === 'drawing' || piece.localName === 'pict') {
              flush();
              parts.push(this.drawing(piece));
            }
          }
          flush();
          break;
        }
        case 'hyperlink': {
          const relationship = this.relationships.get(
            node.getAttributeNS(NS_R, 'id') ?? node.getAttribute('r:id') ?? ''
          );
          const inner = this.inline(node);
          parts.push(relationship?.external ? `<a href="${html(relationship.target)}">${inner}</a>` : inner);
          break;
        }
        case 'ins':
        case 'del':
        case 'moveTo':
        case 'moveFrom': {
          // Word revisions become tracked changes of the editor; moved text is a deletion at its old place and an
          // insertion at its new one.
          const tag = node.localName === 'ins' || node.localName === 'moveTo' ? 'ins' : 'del';
          const id = html(attr(node, 'id') ?? '0');
          const author = html(attr(node, 'author') ?? '');
          const date = html(attr(node, 'date') ?? '');
          parts.push(
            `<${tag} data-change="w${id}" data-author="${author}" data-time="${date}">${this.inline(node)}</${tag}>`
          );
          break;
        }
        case 'smartTag':
        case 'fldSimple':
        case 'customXml':
          parts.push(this.inline(node));
          break;
        case 'sdt':
          parts.push(this.inline(child(node, 'sdtContent') ?? node));
          break;
        default:
          // Bookmarks, comments and field codes are not content.
          break;
      }
    }
    return parts.join('');
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Blocks

  /** Inline style and attributes of a paragraph from its properties. */
  private paragraphAttributes(properties: Element | null): string {
    if (!properties) return '';
    const styles: string[] = [];
    const attributes: string[] = [];
    const jc = attr(child(properties, 'jc'), 'val');
    const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc ?? ''];
    if (align) styles.push(`text-align: ${align}`);
    const indent = child(properties, 'ind');
    const left = Number(attr(indent, 'left') ?? attr(indent, 'start') ?? 0) / TWIPS_PER_PX;
    const right = Number(attr(indent, 'right') ?? attr(indent, 'end') ?? 0) / TWIPS_PER_PX;
    const firstLine = (Number(attr(indent, 'firstLine') ?? 0) - Number(attr(indent, 'hanging') ?? 0)) / TWIPS_PER_PX;
    if (left > 0) styles.push(`margin-left: ${Math.round(left)}px`);
    if (right > 0) styles.push(`margin-right: ${Math.round(right)}px`);
    if (firstLine) styles.push(`text-indent: ${Math.round(firstLine)}px`);
    const spacing = child(properties, 'spacing');
    const before = Number(attr(spacing, 'before') ?? 0) / 20;
    const after = Number(attr(spacing, 'after') ?? 0) / 20;
    if (before > 0) attributes.push(`data-space-before="${before}"`);
    if (after > 0) attributes.push(`data-space-after="${after}"`);
    const line = Number(attr(spacing, 'line') ?? 0);
    const rule = attr(spacing, 'lineRule');
    if (line > 0 && (!rule || rule === 'auto'))
      styles.push(`line-height: ${Math.round((line / LINE_UNIT) * 100) / 100}`);
    if (isOn(child(properties, 'bidi'))) attributes.push('dir="rtl"');
    if (styles.length) attributes.push(`style="${styles.join('; ')}"`);
    return attributes.length ? ` ${attributes.join(' ')}` : '';
  }

  /** Converts the block children of the body or a table cell; consecutive list paragraphs become nested lists. */
  blocks(container: Element): string {
    const output: string[] = [];
    let list: ListParagraph[] = [];
    const flushList = () => {
      if (list.length) output.push(this.buildList(list));
      list = [];
    };

    for (const node of children(container)) {
      if (node.localName === 'sdt') {
        flushList();
        output.push(this.blocks(child(node, 'sdtContent') ?? node));
        continue;
      }
      if (node.localName === 'tbl') {
        flushList();
        output.push(this.table(node));
        continue;
      }
      if (node.localName !== 'p') continue;

      const properties = child(node, 'pPr');
      if (isOn(child(properties, 'pageBreakBefore'))) {
        flushList();
        output.push('<div data-type="page-break"></div>');
      }
      const styleId = attr(child(properties, 'pStyle'), 'val') ?? '';
      const heading = this.headingStyles.get(styleId);
      const tag = heading ? `h${heading}` : 'p';
      const attributes = this.paragraphAttributes(properties);
      const content = this.inline(node);
      const numbering = child(properties, 'numPr');
      const numId = attr(child(numbering, 'numId'), 'val');
      if (numId && numId !== '0' && !heading) {
        const level = Number(attr(child(numbering, 'ilvl'), 'val') ?? 0);
        const format = this.numbering.get(numId)?.get(level) ?? { ordered: false, legal: false };
        // Another numbering instance at the top level starts a separate list.
        if (level === 0 && list.length && list[0]?.numId !== numId) flushList();
        list.push({ numId, level, content: content.replaceAll(PAGE_BREAK_MARK, ''), format });
        continue;
      }
      flushList();
      // A page break inside a paragraph splits it: the text before the break stays on the page, the rest follows.
      const pieces = content.split(PAGE_BREAK_MARK);
      pieces.forEach((piece, index) => {
        if (index > 0) output.push('<div data-type="page-break"></div>');
        if (piece || pieces.length === 1) output.push(`<${tag}${attributes}>${piece}</${tag}>`);
      });
    }
    flushList();
    return output.join('');
  }

  /** Nests list paragraphs by level; a list is ordered or bulleted by the format of its first item. */
  private buildList(items: ListParagraph[]): string {
    let result = '';
    const open: Array<{ tag: string; level: number }> = [];
    for (const item of items) {
      while (open.length && (open.at(-1)?.level ?? 0) > item.level) {
        result += `</li></${open.pop()?.tag}>`;
      }
      const top = open.at(-1);
      if (!top || top.level < item.level) {
        const tag = item.format.ordered ? 'ol' : 'ul';
        // Nested lists inherit legal numbering from the outermost list, which alone carries the attribute.
        const legal = item.format.legal && tag === 'ol' && open.length === 0;
        result += `<${tag}${legal ? ' data-numbering="legal"' : ''}><li>`;
        open.push({ tag, level: item.level });
      } else {
        result += '</li><li>';
      }
      result += `<p>${item.content}</p>`;
    }
    while (open.length) result += `</li></${open.pop()?.tag}>`;
    return result;
  }

  /** A table with column widths, spans and vertical merges; a table without borders becomes a signature table. */
  private table(table: Element): string {
    const widths = children(child(table, 'tblGrid'), 'gridCol').map(
      column => Number(attr(column, 'w') ?? 0) / TWIPS_PER_PX
    );
    const borders = child(child(table, 'tblPr'), 'tblBorders');
    const borderless =
      borders !== null && children(borders).every(border => ['none', 'nil'].includes(attr(border, 'val') ?? ''));
    const rows = children(table, 'tr');

    // Grid position of every cell, used to count how many rows a vertical merge spans.
    const layout = rows.map(row => {
      let column = 0;
      return children(row, 'tc').map(cell => {
        const properties = child(cell, 'tcPr');
        const span = Math.max(1, Number(attr(child(properties, 'gridSpan'), 'val') ?? 1));
        const merge = child(properties, 'vMerge');
        const entry = {
          cell,
          column,
          span,
          merge: merge ? (attr(merge, 'val') === 'restart' ? 'restart' : 'continue') : null
        };
        column += span;
        return entry;
      });
    });

    const body = layout
      .map((row, rowIndex) => {
        const cells = row
          .filter(entry => entry.merge !== 'continue')
          .map(entry => {
            let rowSpan = 1;
            if (entry.merge === 'restart') {
              for (let next = rowIndex + 1; next < layout.length; next += 1) {
                const below = layout[next]?.find(candidate => candidate.column === entry.column);
                if (below?.merge !== 'continue') break;
                rowSpan += 1;
              }
            }
            const spans = `${entry.span > 1 ? ` colspan="${entry.span}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}`;
            return `<td${spans}>${this.blocks(entry.cell) || '<p></p>'}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    // Equal columns are what tables without explicit widths get; the editor lays those out by itself.
    const equal = widths.every(width => Math.abs(width - (widths[0] ?? 0)) < 1);
    const colgroup =
      widths.length && widths.every(width => width > 0) && !equal
        ? `<colgroup>${widths.map(width => `<col style="width: ${Math.round(width)}px">`).join('')}</colgroup>`
        : '';
    return `<table${borderless ? ' data-type="signature"' : ''}>${colgroup}<tbody>${body}</tbody></table>`;
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Page setup

  /** Plain text of a header or footer part, with page fields as `{page}` and `{pages}` and tabs splitting the parts. */
  private runningText(relationshipId: string | null): PageHeaderFooter | undefined {
    const target = relationshipId ? this.relationships.get(relationshipId)?.target : undefined;
    const part = target ? parsePart(this.files, `word/${target}`) : null;
    if (!part) return undefined;
    let text = '';
    let fieldCode = '';
    let inResult = false;
    const walk = (element: Element) => {
      for (const node of children(element)) {
        switch (node.localName) {
          case 't':
            if (!inResult) text += node.textContent ?? '';
            break;
          case 'tab':
            text += '\t';
            break;
          case 'instrText':
            fieldCode += node.textContent ?? '';
            break;
          case 'fldChar': {
            const type = attr(node, 'fldCharType');
            if (type === 'begin') fieldCode = '';
            if (type === 'separate') {
              const code = fieldCode.trim().split(/\s+/)[0]?.toUpperCase();
              if (code === 'PAGE') text += '{page}';
              if (code === 'NUMPAGES' || code === 'SECTIONPAGES') text += '{pages}';
              inResult = code === 'PAGE' || code === 'NUMPAGES' || code === 'SECTIONPAGES';
            }
            if (type === 'end') inResult = false;
            break;
          }
          case 'fldSimple': {
            const code = (attr(node, 'instr') ?? '').trim().split(/\s+/)[0]?.toUpperCase();
            if (code === 'PAGE') text += '{page}';
            else if (code === 'NUMPAGES') text += '{pages}';
            else walk(node);
            break;
          }
          case 'p':
            if (text && !text.endsWith('\t')) text += ' ';
            walk(node);
            break;
          default:
            walk(node);
        }
      }
    };
    walk(part.documentElement);
    const parts = text
      .trim()
      .split('\t')
      .map(value => value.trim());
    if (!parts.some(Boolean)) return undefined;
    if (parts.length === 1) return { left: '', center: parts[0] ?? '', right: '' };
    if (parts.length === 2) return { left: parts[0] ?? '', center: '', right: parts[1] ?? '' };
    return { left: parts[0] ?? '', center: parts[1] ?? '', right: parts.slice(2).join(' ') };
  }

  /** Page setup from the last section properties of the body. */
  pageSettings(body: Element | null): PageSettings {
    const section = children(body, 'sectPr').at(-1) ?? null;
    const size = child(section, 'pgSz');
    const margins = child(section, 'pgMar');
    const toMm = (value: string | null, fallback: number) =>
      value === null ? fallback : Math.round((Number(value) / TWIPS_PER_MM) * 10) / 10;
    const width = toMm(attr(size, 'w'), PAGE_SIZES.a4.width);
    const height = toMm(attr(size, 'h'), PAGE_SIZES.a4.height);
    const landscape = attr(size, 'orient') === 'landscape' || width > height;
    const portraitWidth = Math.min(width, height);
    const portraitHeight = Math.max(width, height);
    const key =
      (Object.keys(PAGE_SIZES) as PageSizeKey[]).find(
        candidate =>
          Math.abs(PAGE_SIZES[candidate].width - portraitWidth) < PAPER_TOLERANCE_MM &&
          Math.abs(PAGE_SIZES[candidate].height - portraitHeight) < PAPER_TOLERANCE_MM
      ) ?? 'a4';
    const fallback = MARGIN_PRESETS[0].margins;
    const headerReference = children(section, 'headerReference').find(reference => attr(reference, 'type') !== 'first');
    const footerReference = children(section, 'footerReference').find(reference => attr(reference, 'type') !== 'first');
    const reference = (element: Element | undefined) =>
      element ? (element.getAttributeNS(NS_R, 'id') ?? element.getAttribute('r:id')) : null;
    const settings: PageSettings = {
      size: key,
      orientation: landscape ? 'landscape' : 'portrait',
      margins: {
        top: toMm(attr(margins, 'top'), fallback.top),
        right: toMm(attr(margins, 'right'), fallback.right),
        bottom: toMm(attr(margins, 'bottom'), fallback.bottom),
        left: toMm(attr(margins, 'left'), fallback.left)
      }
    };
    const header = this.runningText(reference(headerReference));
    const footer = this.runningText(reference(footerReference));
    if (header) settings.header = header;
    if (footer) settings.footer = footer;
    // A title page keeps its own (usually empty) header and footer, which the editor shows as none.
    if (isOn(child(section, 'titlePg'))) settings.differentFirstPage = true;
    const firstNumber = Number.parseInt(attr(child(section, 'pgNumType'), 'start') ?? '', 10);
    if (Number.isInteger(firstNumber) && firstNumber !== 1) settings.firstPageNumber = firstNumber;
    return settings;
  }
}

/**
 * Reads a `.docx` file into editor HTML and page settings.
 *
 * @throws Error when the file is not a Word document.
 */
export const readDocx = async (data: ArrayBuffer | Uint8Array): Promise<DocxImport> => {
  const files = await readZip(data);
  const document = parsePart(files, 'word/document.xml');
  const body = descendants(document, 'body')[0];
  if (!body) throw new Error('Not a Word document');
  const reader = new DocxReader(files);
  return { html: reader.blocks(body), page: reader.pageSettings(body) };
};
