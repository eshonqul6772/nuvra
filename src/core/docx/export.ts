/**
 * Writes the document as a real Word file (Office Open XML, `.docx`): paragraphs and headings with their alignment,
 * indents and spacing, character formatting, links, lists, tables with merged cells, images, page breaks, the page
 * setup, headers and footers with page fields, and the watermark.
 */
import {
  PAGE_SIZES,
  type PageHeaderFooter,
  type PageSettings,
  type PageWatermark,
  hasHeaderFooterText,
  hasWatermarkText,
  renderHeaderFooter
} from '../page';
import { type ZipEntry, createZip } from './zip';

/** What the Word writer needs to know about the document. */
export interface DocxSource {
  /** Clean document HTML as saved by the editor. */
  html: string;
  /** Document title, stored in the file properties and used by the `{title}` token. */
  title: string;
  /** Page size, orientation, margins, running texts and watermark. */
  page: PageSettings;
}

/** MIME type of Word documents. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Twentieths of a point per CSS pixel (1px = 0.75pt). */
const TWIPS_PER_PX = 15;
/** Twentieths of a point per millimetre. */
const TWIPS_PER_MM = 1440 / 25.4;
/** English Metric Units per CSS pixel, the unit of drawing sizes. */
const EMU_PER_PX = 9525;
/** Half-points per point, the unit of font sizes. */
const HALF_POINTS_PER_POINT = 2;
/** Line spacing unit: 240 means single spacing. */
const LINE_UNIT = 240;
/** Left indent of a list level, in twips. */
const LIST_INDENT = 720;
/** Hanging indent of a list item's first line, in twips. */
const LIST_HANGING = 360;
/** Default document font size in half-points (12pt). */
const DEFAULT_FONT_SIZE = 24;
/** Heading font sizes in half-points, H1 to H6. */
const HEADING_SIZES = [40, 32, 28, 24, 22, 20];
/** Deepest list level Word supports. */
const MAX_LIST_LEVEL = 8;
/** Largest image width when an image has no size, in pixels. */
const FALLBACK_IMAGE_WIDTH = 480;

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Image formats Word reads, by MIME type. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp'
};

/** Escapes text for XML. */
const xml = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character
  );

/** Converts a CSS colour (`#rgb`, `#rrggbb` or `rgb()`) to Word's `RRGGBB`, or `null` for other values. */
const toHexColor = (value: string | null | undefined): string | null => {
  const color = value?.trim() ?? '';
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#([\da-f]{6})$/i.exec(color);
  if (long?.[1]) return long[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (!rgb) return null;
  return rgb
    .slice(1, 4)
    .map(part => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};

/** Parses a CSS length in px or pt into pixels; other units give 0. */
const toPx = (value: string | null | undefined): number => {
  const number = Number.parseFloat(value ?? '');
  if (!Number.isFinite(number)) return 0;
  return value?.trim().endsWith('pt') ? number / 0.75 : number;
};

/** Character formatting carried down to the runs. */
interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  vertAlign?: 'superscript' | 'subscript';
  color?: string;
  /** Font size in half-points. */
  size?: number;
  font?: string;
  highlight?: string;
  /** Character style, e.g. `Hyperlink`. */
  style?: string;
}

/** Paragraph properties written before the runs. */
interface ParagraphFormat {
  style?: string;
  numbering?: { numId: number; level: number };
  /** Extra left indent inherited from quotes, in twips. */
  indent?: number;
}

/** An image collected for the package. */
interface MediaFile {
  id: string;
  name: string;
  data: Uint8Array;
}

/** Builds the parts of one document. */
class DocxWriter {
  private readonly relationships: string[] = [];
  private readonly media: MediaFile[] = [];
  private readonly numbering: Array<{ numId: number; abstractId: number; start: number }> = [];
  /** Texts of the footnotes, in the order they are referenced; the first gets id 1. */
  readonly footnotes: string[] = [];
  private nextRelationship = 1;
  private nextDrawing = 1;
  private nextRevision = 1;

  constructor(private readonly contentWidthPx: number) {}

  /** Adds a relationship of the main document and returns its id. */
  private relate(type: string, target: string, external = false): string {
    const id = `rId${this.nextRelationship++}`;
    this.relationships.push(
      `<Relationship Id="${id}" Type="${REL_BASE}/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`
    );
    return id;
  }

  /** Reserves relationships for the fixed parts, so their ids are known before the body is written. */
  fixedParts(hasHeader: boolean, hasFooter: boolean) {
    this.relate('styles', 'styles.xml');
    this.relate('numbering', 'numbering.xml');
    this.relate('settings', 'settings.xml');
    return {
      header: hasHeader ? this.relate('header', 'header1.xml') : null,
      footer: hasFooter ? this.relate('footer', 'footer1.xml') : null
    };
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Runs

  /** Run properties for a format. */
  private runProperties(format: RunFormat): string {
    const parts: string[] = [];
    if (format.style) parts.push(`<w:rStyle w:val="${format.style}"/>`);
    const font = format.code ? 'Consolas' : format.font;
    if (font)
      parts.push(
        `<w:rFonts w:ascii="${xml(font)}" w:hAnsi="${xml(font)}" w:cs="${xml(font)}" w:eastAsia="${xml(font)}"/>`
      );
    if (format.bold) parts.push('<w:b/><w:bCs/>');
    if (format.italic) parts.push('<w:i/><w:iCs/>');
    if (format.strike) parts.push('<w:strike/>');
    if (format.color) parts.push(`<w:color w:val="${format.color}"/>`);
    if (format.size) parts.push(`<w:sz w:val="${format.size}"/><w:szCs w:val="${format.size}"/>`);
    // Word requires the schema order of run properties: underline comes before shading.
    if (format.underline) parts.push('<w:u w:val="single"/>');
    if (format.highlight) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${format.highlight}"/>`);
    if (format.vertAlign) parts.push(`<w:vertAlign w:val="${format.vertAlign}"/>`);
    return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
  }

  /** Runs of a text, with tabs as Word tabs. */
  private textRuns(text: string, format: RunFormat): string {
    const properties = this.runProperties(format);
    return text
      .split('\t')
      .map((part, index) => {
        const tab = index > 0 ? '<w:tab/>' : '';
        const content = part ? `<w:t xml:space="preserve">${xml(part)}</w:t>` : '';
        return tab || content ? `<w:r>${properties}${tab}${content}</w:r>` : '';
      })
      .join('');
  }

  /** The formatting an inline element adds to its content. */
  private inlineFormat(element: HTMLElement, inherited: RunFormat): RunFormat {
    const format: RunFormat = { ...inherited };
    switch (element.tagName) {
      case 'STRONG':
      case 'B':
        format.bold = true;
        break;
      case 'EM':
      case 'I':
        format.italic = true;
        break;
      case 'U':
        format.underline = true;
        break;
      case 'S':
        format.strike = true;
        break;
      case 'CODE':
        format.code = true;
        break;
      case 'SUP':
        format.vertAlign = 'superscript';
        break;
      case 'SUB':
        format.vertAlign = 'subscript';
        break;
      case 'MARK':
        format.highlight = toHexColor(element.getAttribute('data-color') || element.style.backgroundColor) ?? 'FEF08A';
        break;
      default:
        break;
    }
    const color = toHexColor(element.style.color);
    if (color && element.tagName !== 'MARK') format.color = color;
    const size = Number.parseFloat(element.style.fontSize);
    if (size > 0) {
      const points = element.style.fontSize.endsWith('px') ? size * 0.75 : size;
      format.size = Math.round(points * HALF_POINTS_PER_POINT);
    }
    const family = element.style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim();
    if (family) format.font = family;
    return format;
  }

  /** Runs of an inline subtree. */
  private inline(node: Node, format: RunFormat): string {
    if (node.nodeType === Node.TEXT_NODE) return this.textRuns((node as Text).data, format);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as HTMLElement;
    if (element.tagName === 'BR') return `<w:r>${this.runProperties(format)}<w:br/></w:r>`;
    if (element.tagName === 'SUP' && element.hasAttribute('data-footnote')) {
      // Word numbers footnotes itself; the number the saved HTML carries is not written.
      this.footnotes.push(element.getAttribute('data-footnote') ?? '');
      const properties = this.runProperties({ ...format, vertAlign: undefined, style: 'FootnoteReference' });
      return `<w:r>${properties}<w:footnoteReference w:id="${this.footnotes.length}"/></w:r>`;
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href');
      const inner = Array.from(element.childNodes)
        .map(child => this.inline(child, { ...format, style: 'Hyperlink' }))
        .join('');
      if (!href) return inner;
      return `<w:hyperlink r:id="${this.relate('hyperlink', href, true)}" w:history="1">${inner}</w:hyperlink>`;
    }
    if ((element.tagName === 'INS' || element.tagName === 'DEL') && element.hasAttribute('data-change')) {
      // Tracked changes become Word revisions, so reviewers accept or reject them in Word too.
      const inner = Array.from(element.childNodes)
        .map(child => this.inline(child, format))
        .join('');
      const date = element.getAttribute('data-time');
      const author = xml(element.getAttribute('data-author') || 'nuvra');
      const attributes = `w:id="${this.nextRevision++}" w:author="${author}"${date ? ` w:date="${xml(date)}"` : ''}`;
      if (element.tagName === 'INS') return `<w:ins ${attributes}>${inner}</w:ins>`;
      const deleted = inner
        .replaceAll('<w:t xml:space="preserve">', '<w:delText xml:space="preserve">')
        .replaceAll('</w:t>', '</w:delText>');
      return `<w:del ${attributes}>${deleted}</w:del>`;
    }
    const next = this.inlineFormat(element, format);
    return Array.from(element.childNodes)
      .map(child => this.inline(child, next))
      .join('');
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Paragraphs

  /** Paragraph properties from the style attributes the editor writes. */
  private paragraphProperties(element: HTMLElement | null, format: ParagraphFormat, extra = ''): string {
    const parts: string[] = [];
    if (format.style) parts.push(`<w:pStyle w:val="${format.style}"/>`);
    if (format.numbering) {
      parts.push(
        `<w:numPr><w:ilvl w:val="${format.numbering.level}"/><w:numId w:val="${format.numbering.numId}"/></w:numPr>`
      );
    }
    parts.push(extra);
    // Word requires the schema order of paragraph properties: bidi, spacing, ind, jc.
    if (element?.getAttribute('dir') === 'rtl') parts.push('<w:bidi/>');
    if (element) {
      const before = Number.parseFloat(element.getAttribute('data-space-before') ?? '');
      const after = Number.parseFloat(element.getAttribute('data-space-after') ?? '');
      const lineHeight = Number.parseFloat(element.style.lineHeight);
      const spacing = [
        before > 0 ? `w:before="${Math.round(before * 20)}"` : '',
        after > 0 ? `w:after="${Math.round(after * 20)}"` : '',
        lineHeight > 0 && !element.style.lineHeight.endsWith('px')
          ? `w:line="${Math.round(lineHeight * LINE_UNIT)}" w:lineRule="auto"`
          : ''
      ].filter(Boolean);
      if (spacing.length) parts.push(`<w:spacing ${spacing.join(' ')}/>`);
    }
    const left = (element ? toPx(element.style.marginLeft) * TWIPS_PER_PX : 0) + (format.indent ?? 0);
    const right = element ? toPx(element.style.marginRight) * TWIPS_PER_PX : 0;
    const firstLine = element ? toPx(element.style.textIndent) * TWIPS_PER_PX : 0;
    if (!format.numbering && (left || right || firstLine)) {
      const first =
        firstLine < 0
          ? `w:hanging="${Math.round(-firstLine)}"`
          : firstLine
            ? `w:firstLine="${Math.round(firstLine)}"`
            : '';
      parts.push(`<w:ind w:left="${Math.round(left)}" w:right="${Math.round(right)}" ${first}/>`);
    }
    const align = element?.style.textAlign;
    const jc = { center: 'center', right: 'right', justify: 'both' }[align ?? ''];
    if (jc) parts.push(`<w:jc w:val="${jc}"/>`);
    const content = parts.filter(Boolean).join('');
    return content ? `<w:pPr>${content}</w:pPr>` : '';
  }

  /** A paragraph from a text block element. */
  private paragraph(element: HTMLElement, format: ParagraphFormat, prefix = ''): string {
    const runs = Array.from(element.childNodes)
      .map(child => this.inline(child, {}))
      .join('');
    return `<w:p>${this.paragraphProperties(element, format)}${prefix}${runs}</w:p>`;
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Blocks

  /** Word markup of the blocks inside a container. */
  async blocks(container: Element, format: ParagraphFormat = {}, depth = 0): Promise<string> {
    const parts: string[] = [];
    for (const child of Array.from(container.children) as HTMLElement[])
      parts.push(await this.block(child, format, depth));
    return parts.join('');
  }

  /** Word markup of one block. */
  private async block(element: HTMLElement, format: ParagraphFormat, depth: number): Promise<string> {
    const heading = /^H([1-6])$/.exec(element.tagName)?.[1];
    if (heading) return this.paragraph(element, { ...format, style: `Heading${heading}` });
    switch (element.tagName) {
      case 'P':
        return this.paragraph(element, format);
      case 'PRE':
        return (element.textContent ?? '')
          .replace(/\n$/, '')
          .split('\n')
          .map(
            line =>
              `<w:p>${this.paragraphProperties(null, { ...format, style: 'Code' })}${this.textRuns(line, {})}</w:p>`
          )
          .join('');
      case 'BLOCKQUOTE':
        return this.blocks(element, { ...format, style: 'Quote' }, depth);
      case 'UL':
      case 'OL':
        return this.list(element, format, depth);
      case 'TABLE':
        return this.table(element as HTMLTableElement);
      case 'HR':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C4CAD4"/></w:pBdr></w:pPr></w:p>';
      case 'IMG':
        return this.image(element as HTMLImageElement);
      case 'DIV':
        return element.getAttribute('data-type') === 'page-break'
          ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
          : this.blocks(element, format, depth);
      default:
        return this.blocks(element, format, depth);
    }
  }

  /**
   * A list: each item's first paragraph carries the numbering, nested lists go one level deeper. Nested ordered lists
   * of a legal (1.1.1) list share its numbering, so Word counts their numbers on from the parent item.
   */
  private async list(list: HTMLElement, format: ParagraphFormat, depth: number, legalNumId = 0): Promise<string> {
    const task = list.getAttribute('data-type') === 'taskList';
    const ordered = list.tagName === 'OL';
    const legal = ordered && (legalNumId > 0 || list.getAttribute('data-numbering') === 'legal');
    let numId = legal && legalNumId ? legalNumId : 0;
    if (!task && !numId) {
      numId = this.numbering.length + 1;
      const start = Number.parseInt(list.getAttribute('start') ?? '', 10);
      this.numbering.push({ numId, abstractId: ordered ? (legal ? 2 : 1) : 0, start: start > 1 ? start : 1 });
    }
    const parts: string[] = [];
    const level = Math.min(depth, MAX_LIST_LEVEL);
    for (const item of Array.from(list.children) as HTMLElement[]) {
      const body = item.querySelector<HTMLElement>(':scope > div') ?? item;
      let first = true;
      for (const child of Array.from(body.children) as HTMLElement[]) {
        if (child.tagName === 'UL' || child.tagName === 'OL') {
          parts.push(await this.list(child, format, depth + 1, legal && child.tagName === 'OL' ? numId : 0));
          continue;
        }
        if (first && child.tagName === 'P') {
          if (task) {
            const box = item.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ ';
            parts.push(
              this.paragraph(
                child,
                { ...format, indent: (format.indent ?? 0) + LIST_INDENT * level },
                this.textRuns(box, {})
              )
            );
          } else {
            parts.push(this.paragraph(child, { ...format, numbering: { numId, level } }));
          }
        } else {
          parts.push(
            await this.block(child, { ...format, indent: (format.indent ?? 0) + LIST_INDENT * (level + 1) }, depth + 1)
          );
        }
        first = false;
      }
    }
    return parts.join('');
  }

  /** A table with its grid, merged cells and, for signature tables, no borders. */
  private async table(table: HTMLTableElement): Promise<string> {
    const rows = Array.from(table.rows);
    const borderless = ['signature', 'toc'].includes(table.getAttribute('data-type') ?? '');
    // Lay the cells out on a grid so row spans become vertical merges in the rows below.
    const grid: Array<Array<{ cell: HTMLTableCellElement; start: boolean } | undefined>> = rows.map(() => []);
    rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        while (grid[rowIndex]?.[column]) column += 1;
        for (let r = 0; r < Math.max(1, cell.rowSpan); r += 1) {
          for (let c = 0; c < Math.max(1, cell.colSpan); c += 1) {
            const target = grid[rowIndex + r];
            if (target) target[column + c] = { cell, start: r === 0 && c === 0 };
          }
        }
        column += Math.max(1, cell.colSpan);
      }
    });
    const columnCount = Math.max(1, ...grid.map(row => row.length));
    const colWidths = Array.from(table.querySelectorAll<HTMLElement>(':scope > colgroup > col')).map(col =>
      toPx(col.style.width)
    );
    const widths =
      colWidths.length === columnCount && colWidths.every(width => width > 0)
        ? colWidths
        : Array.from({ length: columnCount }, () => this.contentWidthPx / columnCount);
    const twips = widths.map(width => Math.round(width * TWIPS_PER_PX));
    const border = borderless ? 'none' : 'single';
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(side => `<w:${side} w:val="${border}" w:sz="4" w:space="0" w:color="8F99A8"/>`)
      .join('');

    const rowXml: string[] = [];
    for (const [rowIndex] of rows.entries()) {
      const cells: string[] = [];
      let column = 0;
      while (column < columnCount) {
        const slot = grid[rowIndex]?.[column];
        if (!slot) {
          cells.push(`<w:tc><w:tcPr><w:tcW w:w="${twips[column] ?? 0}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`);
          column += 1;
          continue;
        }
        const span = Math.max(1, slot.cell.colSpan);
        const width = twips.slice(column, column + span).reduce((sum, value) => sum + value, 0);
        const merge = slot.cell.rowSpan > 1 ? (slot.start ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '';
        const shading =
          slot.cell.tagName === 'TH' && !borderless ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>' : '';
        // Rows a merged cell spans into get an empty continuation cell; a cell must end with a paragraph.
        const content = slot.start ? await this.blocks(slot.cell, {}, 0) : '';
        const closed = /<\/w:p>$|<w:p\/>$/.test(content) ? content : `${content}<w:p/>`;
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${merge}${shading}</w:tcPr>${closed}</w:tc>`
        );
        column += span;
      }
      rowXml.push(`<w:tr>${cells.join('')}</w:tr>`);
    }
    const totalWidth = twips.reduce((sum, value) => sum + value, 0);
    return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${twips.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rowXml.join('')}</w:tbl>`;
  }

  /** Reads image bytes from a data URL or by fetching the address; `null` when it cannot be read. */
  private async imageData(src: string): Promise<{ data: Uint8Array; extension: string } | null> {
    try {
      const data = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
      if (data) {
        const extension = IMAGE_EXTENSIONS[data[1] ?? ''];
        if (!extension) return null;
        const payload = data[2] ? atob(data[3] ?? '') : decodeURIComponent(data[3] ?? '');
        return { data: Uint8Array.from(payload, character => character.charCodeAt(0)), extension };
      }
      const response = await fetch(src);
      const extension = IMAGE_EXTENSIONS[response.headers.get('content-type')?.split(';')[0] ?? ''];
      if (!response.ok || !extension) return null;
      return { data: new Uint8Array(await response.arrayBuffer()), extension };
    } catch {
      return null;
    }
  }

  /** An image in its own paragraph, aligned like in the editor. */
  private async image(image: HTMLImageElement): Promise<string> {
    const src = image.getAttribute('src') ?? '';
    const file = await this.imageData(src);
    if (!file) return '';
    let width = Number.parseInt(image.getAttribute('width') ?? '', 10);
    let height = Number.parseInt(image.getAttribute('height') ?? '', 10);
    if (!(width > 0 && height > 0)) {
      const natural = { width: image.naturalWidth, height: image.naturalHeight };
      width = natural.width || FALLBACK_IMAGE_WIDTH;
      height = natural.height || Math.round(width * 0.75);
    }
    if (width > this.contentWidthPx) {
      height = Math.round((height * this.contentWidthPx) / width);
      width = Math.round(this.contentWidthPx);
    }
    const index = this.nextDrawing++;
    const name = `image${index}.${file.extension}`;
    const id = this.relate('image', `media/${name}`);
    this.media.push({ id, name, data: file.data });
    const cx = width * EMU_PER_PX;
    const cy = height * EMU_PER_PX;
    const alt = xml(image.getAttribute('alt') ?? '');
    const jc = { left: 'left', right: 'right' }[image.getAttribute('data-align') ?? ''] ?? 'center';
    return `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="${name}" descr="${alt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${index}" name="${name}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Package parts

  /** `word/_rels/document.xml.rels`. */
  relationshipsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.relationships.join('')}</Relationships>`;
  }

  /** Adds the footnotes part to the package relationships; call after the body is written. */
  relateFootnotes(): void {
    if (this.footnotes.length) this.relate('footnotes', 'footnotes.xml');
  }

  /** `word/footnotes.xml`: Word's separators, then one footnote per reference. */
  footnotesXml(): string {
    const separator = (type: string, id: number) =>
      `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${type}/></w:r></w:p></w:footnote>`;
    const notes = this.footnotes
      .map(
        (text, index) =>
          `<w:footnote w:id="${index + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${xml(text)}</w:t></w:r></w:p></w:footnote>`
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${NS_W}" xmlns:r="${NS_R}">${separator('separator', -1)}${separator('continuationSeparator', 0)}${notes}</w:footnotes>`;
  }

  /** Images collected while writing the body. */
  mediaEntries(): ZipEntry[] {
    return this.media.map(file => ({ name: `word/media/${file.name}`, data: file.data }));
  }

  /** `word/numbering.xml`: bullets, nested decimals and legal (1.1.1) numbering, with one instance per list. */
  numberingXml(): string {
    const levels = (format: (level: number) => { numFmt: string; text: string }) =>
      Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => {
        const { numFmt, text } = format(level);
        return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/><w:lvlText w:val="${xml(text)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${LIST_INDENT * (level + 1)}" w:hanging="${LIST_HANGING}"/></w:pPr></w:lvl>`;
      }).join('');
    const bullets = ['•', '◦', '▪'];
    const decimals = ['decimal', 'lowerLetter', 'lowerRoman'];
    const abstracts = [
      levels(level => ({ numFmt: 'bullet', text: bullets[level % bullets.length] ?? '•' })),
      levels(level => ({ numFmt: decimals[level % decimals.length] ?? 'decimal', text: `%${level + 1}.` })),
      levels(level => ({
        numFmt: 'decimal',
        text: `${Array.from({ length: level + 1 }, (_, index) => `%${index + 1}`).join('.')}.`
      }))
    ]
      .map(
        (content, id) =>
          `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${content}</w:abstractNum>`
      )
      .join('');
    const instances = this.numbering
      .map(
        ({ numId, abstractId, start }) =>
          `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS_W}">${abstracts}${instances}</w:numbering>`;
  }
}

/** `word/styles.xml`: document defaults matching the editor's typography, headings, quote, code and links. */
const stylesXml = (): string => {
  const heading = (level: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="120" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${HEADING_SIZES[level - 1]}"/><w:szCs w:val="${HEADING_SIZES[level - 1]}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="${DEFAULT_FONT_SIZE}"/><w:szCs w:val="${DEFAULT_FONT_SIZE}"/><w:lang w:val="uz-Latn-UZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[1, 2, 3, 4, 5, 6].map(heading).join('')}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B3C5F5"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="475467"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F6F8"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1D4ED8"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>`;
};

/** Paper width and height in millimetres in the chosen orientation. */
const paperSize = ({ size, orientation }: PageSettings) => {
  const paper = PAGE_SIZES[size] ?? PAGE_SIZES.a4;
  return orientation === 'portrait'
    ? { width: paper.width, height: paper.height }
    : { width: paper.height, height: paper.width };
};

/** A header or footer part: one paragraph with centre and right tab stops, and Word page fields. */
const runningXml = (
  kind: 'hdr' | 'ftr',
  value: PageHeaderFooter | undefined,
  title: string,
  contentWidthTwips: number,
  watermark = ''
): string => {
  const field = (code: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const part = (text: string) =>
    text
      .split(/(\{page\}|\{pages\})/)
      .map(chunk => {
        if (chunk === '{page}') return field('PAGE');
        if (chunk === '{pages}') return field('NUMPAGES');
        const rendered = renderHeaderFooter(chunk, { page: 1, pages: 1, title });
        return rendered
          ? `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xml(rendered)}</w:t></w:r>`
          : '';
      })
      .join('');
  const tab = '<w:r><w:tab/></w:r>';
  const content = value ? `${part(value.left)}${tab}${part(value.center)}${tab}${part(value.right)}` : '';
  const tabs = `<w:tabs><w:tab w:val="center" w:pos="${Math.round(contentWidthTwips / 2)}"/><w:tab w:val="right" w:pos="${contentWidthTwips}"/></w:tabs>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind} xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:p><w:pPr>${tabs}<w:spacing w:after="0"/></w:pPr>${watermark}${content}</w:p></w:${kind}>`;
};

/** The watermark as Word writes its own: a VML text shape behind the text, anchored in the header. */
const watermarkXml = (watermark: PageWatermark | undefined): string => {
  if (!hasWatermarkText(watermark) || !watermark) return '';
  const color = toHexColor(watermark.color) ?? '9CA3AF';
  const rotation = watermark.diagonal ? 'rotation:315;' : '';
  return `<w:r><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:path textpathok="t" o:connecttype="custom"/><v:textpath on="t" fitshape="t"/></v:shapetype><v:shape id="NuvraWatermark" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:117pt;${rotation}z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#${color}" stroked="f"><v:fill opacity=".16"/><v:textpath style="font-family:&quot;Times New Roman&quot;;font-size:1pt" string="${xml(watermark.text.trim())}"/></v:shape></w:pict></w:r>`;
};

/** Builds a `.docx` file of the document. Images are embedded from data URLs or fetched from their address. */
export const buildDocx = async ({ html, title, page }: DocxSource): Promise<Blob> => {
  const { width, height } = paperSize(page);
  const { margins } = page;
  const toTwips = (mm: number) => Math.round(mm * TWIPS_PER_MM);
  const contentWidthTwips = toTwips(width - margins.left - margins.right);
  const writer = new DocxWriter(contentWidthTwips / TWIPS_PER_PX);
  const hasHeader = hasHeaderFooterText(page.header) || hasWatermarkText(page.watermark);
  const hasFooter = hasHeaderFooterText(page.footer);
  const parts = writer.fixedParts(hasHeader, hasFooter);

  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = await writer.blocks(parsed.body);
  writer.relateFootnotes();
  const hasFootnotes = writer.footnotes.length > 0;
  const references = `${parts.header ? `<w:headerReference w:type="default" r:id="${parts.header}"/>` : ''}${parts.footer ? `<w:footerReference w:type="default" r:id="${parts.footer}"/>` : ''}`;
  const orientation = page.orientation === 'landscape' ? ' w:orient="landscape"' : '';
  // Page numbering and the title page follow the margins in the schema order of section properties.
  const firstNumber = page.firstPageNumber ?? 1;
  const numbering = firstNumber === 1 ? '' : `<w:pgNumType w:start="${firstNumber}"/>`;
  const titlePage = page.differentFirstPage ? '<w:titlePg/>' : '';
  const section = `<w:sectPr>${references}<w:pgSz w:w="${toTwips(width)}" w:h="${toTwips(height)}"${orientation}/><w:pgMar w:top="${toTwips(margins.top)}" w:right="${toTwips(margins.right)}" w:bottom="${toTwips(margins.bottom)}" w:left="${toTwips(margins.left)}" w:header="${toTwips(margins.top / 2)}" w:footer="${toTwips(margins.bottom / 2)}" w:gutter="0"/>${numbering}${titlePage}</w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}${section}</w:body></w:document>`;

  const encoder = new TextEncoder();
  const text = (name: string, content: string): ZipEntry => ({ name, data: encoder.encode(content) });
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const imageDefaults = Object.values(IMAGE_EXTENSIONS)
    .map(extension => `<Default Extension="${extension}" ContentType="image/${extension}"/>`)
    .join('');
  const entries: ZipEntry[] = [
    text(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${hasFootnotes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ''}${hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
    ),
    text(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
    ),
    text(
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>nuvra</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
    ),
    text('word/document.xml', documentXml),
    text('word/styles.xml', stylesXml()),
    text('word/numbering.xml', writer.numberingXml()),
    text(
      'word/settings.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${NS_W}"><w:defaultTabStop w:val="720"/>${hasFootnotes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    ),
    ...writer.mediaEntries()
  ];
  if (hasHeader)
    entries.push(
      text('word/header1.xml', runningXml('hdr', page.header, title, contentWidthTwips, watermarkXml(page.watermark)))
    );
  if (hasFooter) entries.push(text('word/footer1.xml', runningXml('ftr', page.footer, title, contentWidthTwips)));
  if (hasFootnotes) entries.push(text('word/footnotes.xml', writer.footnotesXml()));
  entries.push(text('word/_rels/document.xml.rels', writer.relationshipsXml()));

  return new Blob([createZip(entries) as BlobPart], { type: DOCX_MIME });
};
