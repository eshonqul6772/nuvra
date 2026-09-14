/**
 * PDF download without the print dialog and without dependencies. Every sheet of the printable document is drawn into
 * a canvas through an SVG `foreignObject`, and the pictures are written into a PDF, one per page. The PDF looks like
 * the printout, but its text cannot be selected or searched.
 */

/** A rendered page: a JPEG picture of the sheet and the paper size it is printed on. */
export interface PdfPage {
  /** JPEG data of the page picture. */
  jpeg: Uint8Array;
  /** Picture width in pixels. */
  width: number;
  /** Picture height in pixels. */
  height: number;
  /** Paper width in PDF points (1/72 inch). */
  widthPt: number;
  /** Paper height in PDF points. */
  heightPt: number;
}

/** Options of {@link renderPdf}. */
export interface PdfOptions {
  /** Pixels per CSS pixel of the page pictures; higher is sharper and larger. Defaults to 2. */
  scale?: number;
  /** JPEG quality between 0 and 1. Defaults to 0.92. */
  quality?: number;
}

/** PDF points per millimetre. */
const PT_PER_MM = 72 / 25.4;
/** CSS pixels per millimetre at 96 DPI. */
const PX_PER_MM = 96 / 25.4;
const DEFAULT_SCALE = 2;
const DEFAULT_QUALITY = 0.92;
/** MIME type of PDF files. */
export const PDF_MIME = 'application/pdf';

const encoder = new TextEncoder();

/**
 * Writes JPEG pictures into a PDF document, one picture filling each page.
 *
 * @returns the PDF file content.
 */
export const buildPdf = (pages: readonly PdfPage[]): Uint8Array => {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** Starts object `id`, remembering where it begins for the cross-reference table. */
  const object = (id: number, body: string) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  // Objects: 1 catalog, 2 page tree, then for every page: page, content stream, image.
  const pageIds = pages.map((_, index) => 3 + index * 3);
  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageId = pageIds[index] ?? 0;
    const width = page.widthPt.toFixed(2);
    const height = page.heightPt.toFixed(2);
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`
    );
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    object(pageId + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[pageId + 2] = length;
    push(
      `${pageId + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  const entries = Array.from({ length: count }, (_, id) =>
    id === 0 ? '0000000000 65535 f \n' : `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`
  );
  push(`xref\n0 ${count}\n${entries.join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
};

/** Reads a blob as a data URL. */
const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Embeds images as data URLs, so the canvas they are drawn into stays readable. Images that cannot be fetched (for
 * example from a server without CORS) are left out of the PDF rather than breaking it.
 */
const embedImages = async (root: ParentNode) => {
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async image => {
      const source = image.getAttribute('src') ?? '';
      if (source.startsWith('data:')) return;
      try {
        const response = await fetch(source, { mode: 'cors' });
        if (!response.ok) throw new Error(String(response.status));
        image.setAttribute('src', await toDataUrl(await response.blob()));
      } catch {
        image.remove();
      }
    })
  );
};

/** Loads an image and waits until it can be drawn. */
const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The page could not be drawn'));
    image.src = source;
  });

/** Draws one sheet into a JPEG picture. */
const renderSheet = async (
  sheet: Element,
  css: string,
  widthPx: number,
  heightPx: number,
  options: Required<PdfOptions>
): Promise<{ jpeg: Uint8Array; width: number; height: number }> => {
  const serializer = new XMLSerializer();
  const body = `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/]]>/g, ']] >')}</style>${serializer.serializeToString(sheet)}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"><foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`;
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPx * options.scale);
  canvas.height = Math.round(heightPx * options.scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', options.quality));
  if (!blob) throw new Error('The page could not be encoded');
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
};

/**
 * Turns the printable HTML of a paginated document (one `section.doc-sheet` per page) into a PDF.
 *
 * @param printableHtml Standalone HTML as built for printing from the page view.
 * @param paper Paper width and height in millimetres, in the chosen orientation.
 */
export const renderPdf = async (
  printableHtml: string,
  paper: { width: number; height: number },
  options: PdfOptions = {}
): Promise<Blob> => {
  const settings: Required<PdfOptions> = {
    scale: options.scale ?? DEFAULT_SCALE,
    quality: options.quality ?? DEFAULT_QUALITY
  };
  const parsed = new DOMParser().parseFromString(printableHtml, 'text/html');
  const css = Array.from(parsed.querySelectorAll('style'), style => style.textContent ?? '').join('\n');
  await embedImages(parsed.body);
  const sheets = Array.from(parsed.querySelectorAll('section.doc-sheet'));
  const pages: PdfPage[] = [];
  for (const sheet of sheets) {
    // A sheet turned by a section break is printed on turned paper.
    const rotated = sheet.classList.contains('is-rotated');
    const width = rotated ? paper.height : paper.width;
    const height = rotated ? paper.width : paper.height;
    const picture = await renderSheet(
      sheet,
      css,
      Math.round(width * PX_PER_MM),
      Math.round(height * PX_PER_MM),
      settings
    );
    pages.push({ ...picture, widthPt: width * PT_PER_MM, heightPt: height * PT_PER_MM });
  }
  return new Blob([buildPdf(pages) as BlobPart], { type: PDF_MIME });
};
