import { describe, expect, it } from 'vitest';

import { buildDocx } from '../src/core/docx/export';
import { readDocx } from '../src/core/docx/import';
import { crc32, createZip, readZip } from '../src/core/docx/zip';
import { sanitizeHtml, serialize } from '../src/core/engine/schema';
import { createPageSettings } from '../src/core/page';

/** Writes HTML to a Word file and reads it back, through the sanitiser like the editor does. */
const roundTrip = async (html: string, page = createPageSettings()) => {
  const blob = await buildDocx({ html, title: 'Test', page });
  const result = await readDocx(await blob.arrayBuffer());
  const root = document.createElement('div');
  root.append(sanitizeHtml(result.html));
  return { html: serialize(root), page: result.page, blob };
};

/** A text part of the package. */
const partOf = async (blob: Blob, name: string) => {
  const files = await readZip(await blob.arrayBuffer());
  return new TextDecoder().decode(files.get(name));
};

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcb_f4_39_26);
  });

  it('reads back what it writes', async () => {
    const data = new TextEncoder().encode('ҳужжат');
    const files = await readZip(createZip([{ name: 'a/б.txt', data }]));
    expect(new TextDecoder().decode(files.get('a/б.txt'))).toBe('ҳужжат');
  });
});

describe('docx export', () => {
  it('writes a valid package with the document parts', async () => {
    const blob = await buildDocx({ html: '<p>Salom</p>', title: 'Xat', page: createPageSettings() });
    const files = await readZip(await blob.arrayBuffer());
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'word/styles.xml',
        'word/numbering.xml',
        'word/_rels/document.xml.rels'
      ])
    );
    const document = await partOf(blob, 'word/document.xml');
    expect(new DOMParser().parseFromString(document, 'application/xml').querySelector('parsererror')).toBeNull();
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
  });

  it('writes page fields and the watermark into the header', async () => {
    const page = {
      ...createPageSettings(),
      header: { left: 'Xat', center: '', right: '{page} / {pages}' },
      watermark: { text: 'NUSXA', color: '#9ca3af', diagonal: true }
    };
    const header = await partOf(await buildDocx({ html: '<p>x</p>', title: 't', page }), 'word/header1.xml');
    expect(header).toContain(' PAGE ');
    expect(header).toContain(' NUMPAGES ');
    expect(header).toContain('string="NUSXA"');
  });
});

describe('docx round trip', () => {
  it('keeps headings, paragraph and character formatting', async () => {
    const { html } = await roundTrip(
      '<h1>Sarlavha</h1><p style="text-align: center">Oddiy <strong>qalin</strong> <em>kursiv</em> <u>tagi</u> <s>chiziq</s> <sup>2</sup></p><p><span style="color: #ff0000; font-size: 14pt">rangli</span> <a href="https://nuvra.uz">havola</a></p>'
    );
    expect(html).toContain('<h1>Sarlavha</h1>');
    expect(html).toMatch(/<p style="text-align: center;?">/);
    expect(html).toContain('<strong>qalin</strong>');
    expect(html).toContain('<em>kursiv</em>');
    expect(html).toContain('<u>tagi</u>');
    expect(html).toContain('<s>chiziq</s>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toMatch(/color: (rgb\(255, 0, 0\)|#ff0000)/);
    expect(html).toContain('font-size: 14pt');
    expect(html).toContain('href="https://nuvra.uz"');
  });

  it('keeps lists, including legal numbering and nesting', async () => {
    const { html } = await roundTrip(
      '<ul><li><p>bir</p></li><li><p>ikki</p></li></ul><ol data-numbering="legal"><li><p>1</p><ol><li><p>1.1</p></li></ol></li><li><p>2</p></li></ol>'
    );
    expect(html).toContain('<ul><li><p>bir</p></li><li><p>ikki</p></li></ul>');
    expect(html).toContain(
      '<ol data-numbering="legal"><li><p>1</p><ol><li><p>1.1</p></li></ol></li><li><p>2</p></li></ol>'
    );
  });

  it('keeps tables with merged cells and borderless signature tables', async () => {
    const { html } = await roundTrip(
      '<table><tbody><tr><td colspan="2"><p>A</p></td></tr><tr><td rowspan="2"><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td></tr></tbody></table><table data-type="signature"><tbody><tr><td><p>Imzo</p></td></tr></tbody></table>'
    );
    expect(html).toContain('<td colspan="2"><p>A</p></td>');
    expect(html).toContain('<td rowspan="2"><p>B</p></td><td><p>C</p></td>');
    expect(html).toContain('<tr><td><p>D</p></td></tr>');
    expect(html).toContain('<table data-type="signature">');
  });

  it('keeps page breaks, images and variables as text', async () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const { html } = await roundTrip(
      `<p>bir</p><div data-type="page-break" class="doc-page-break"></div><p>ikki <span data-variable="fio">{{fio}}</span></p><img src="${pixel}" width="20" height="10" data-align="center">`
    );
    expect(html).toContain('<div data-type="page-break" class="doc-page-break"></div>');
    expect(html).toContain('{{fio}}');
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" width="20" height="10" data-align="center">/);
  });

  it('keeps the page setup and running texts', async () => {
    const page = {
      size: 'a5' as const,
      orientation: 'landscape' as const,
      margins: { top: 20, right: 15, bottom: 20, left: 30 },
      header: { left: 'Chap', center: 'Markaz', right: '{page}' }
    };
    const result = await roundTrip('<p>x</p>', page);
    expect(result.page.size).toBe('a5');
    expect(result.page.orientation).toBe('landscape');
    expect(result.page.margins).toEqual({ top: 20, right: 15, bottom: 20, left: 30 });
    expect(result.page.header).toEqual({ left: 'Chap', center: 'Markaz', right: '{page}' });
    expect(result.page.differentFirstPage).toBeUndefined();
    expect(result.page.firstPageNumber).toBeUndefined();
  });

  it('keeps a title page and the first page number', async () => {
    const page = { ...createPageSettings(), differentFirstPage: true, firstPageNumber: 3 };
    const result = await roundTrip('<p>x</p>', page);
    expect(await partOf(result.blob, 'word/document.xml')).toContain(
      '<w:pgNumType w:start="3"/><w:titlePg/></w:sectPr>'
    );
    expect(result.page.differentFirstPage).toBe(true);
    expect(result.page.firstPageNumber).toBe(3);
  });
});
