import { afterEach, describe, expect, it } from 'vitest';

import { buildDocx } from '../src/core/docx/export';
import { readDocx } from '../src/core/docx/import';
import { readZip } from '../src/core/docx/zip';
import { DocumentEngine } from '../src/core/engine/engine';
import { sanitizeHtml, serialize } from '../src/core/engine/schema';
import { buildPrintableHtml } from '../src/core/export';
import type { PageMetrics } from '../src/core/page';
import { createPageSettings } from '../src/core/page';
import { type SheetGeometry, createPagination, sheetIndexAt } from '../src/core/pagination';

const clean = (html: string) => {
  const root = document.createElement('div');
  root.append(sanitizeHtml(html));
  return serialize(root);
};

describe('section breaks', () => {
  it('are kept by the sanitiser with a valid orientation', () => {
    expect(clean('<p>a</p><div data-type="section-break" data-orientation="landscape">x</div><p>b</p>')).toBe(
      '<p>a</p><div data-type="section-break" data-orientation="landscape" class="doc-page-break doc-section-break"></div><p>b</p>'
    );
    expect(clean('<div data-type="section-break" data-orientation="sideways"></div>')).toContain(
      'data-orientation="portrait"'
    );
  });

  it('are inserted by the engine at the caret', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const engine = new DocumentEngine(root, {
      content: '<p>jadval oldidan</p>',
      editable: true,
      maxLength: 0,
      placeholder: () => '',
      onImageFiles: () => undefined
    });
    engine.focus('end');
    engine.insertSectionBreak('landscape');
    expect(engine.getHTML()).toContain('<div data-type="section-break" data-orientation="landscape"');
  });

  it('turn the printed sheets they start', () => {
    const html = buildPrintableHtml({
      html: '',
      pages: ['<p>a</p>', '<table></table>'],
      rotated: [false, true],
      title: 't',
      page: createPageSettings()
    });
    expect(html).toContain('<section class="doc-sheet is-rotated">');
    expect(html).toContain('@page rotated { size: 297mm 210mm; margin: 0; }');
  });

  it('become Word sections and come back', async () => {
    const source =
      '<p>kitob</p><div data-type="section-break" data-orientation="landscape"></div><p>albom</p><div data-type="section-break" data-orientation="portrait"></div><p>yana kitob</p>';
    const page = { ...createPageSettings(), differentFirstPage: true };
    const blob = await buildDocx({ html: source, title: 't', page });
    const document = new TextDecoder().decode((await readZip(await blob.arrayBuffer())).get('word/document.xml'));
    const sections = document.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? [];
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(sections[0]).toContain('<w:titlePg/>');
    expect(sections[1]).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
    expect(sections[1]).not.toContain('<w:titlePg/>');
    expect(sections[2]).toContain('<w:pgSz w:w="11906" w:h="16838"/>');

    const result = await readDocx(await blob.arrayBuffer());
    expect(result.page.orientation).toBe('portrait');
    expect(result.page.differentFirstPage).toBe(true);
    expect(clean(result.html)).toBe(clean(source));
  });
});

describe('pagination with sections', () => {
  const metrics: PageMetrics = {
    width: 800,
    height: 1000,
    gap: 20,
    marginTop: 100,
    marginRight: 100,
    marginBottom: 100,
    marginLeft: 100
  };
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
  });

  it('lays out turned sheets after a section break and marks their blocks', async () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.tagName === 'P' ? 100 : 0;
      }
    });
    const root = document.createElement('div');
    root.innerHTML =
      '<p>a</p><div data-type="section-break" data-orientation="landscape"></div><p>b</p><div data-type="section-break" data-orientation="portrait"></div><p>c</p>';
    const stage = document.createElement('div');
    stage.append(root);
    document.body.append(stage);
    let top = metrics.marginTop;
    for (const child of Array.from(root.children)) {
      const value = top;
      Object.defineProperty(child, 'offsetTop', { configurable: true, get: () => value });
      top += child.tagName === 'P' ? 100 : 0;
    }
    let sheets: SheetGeometry[] = [];
    const pagination = createPagination(root, {
      onPageCount: () => undefined,
      onSheets: value => {
        sheets = value;
      },
      isComposing: () => false
    });
    pagination.setMetrics(metrics);
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    await new Promise(resolve => setTimeout(resolve, 20));
    pagination.destroy();

    expect(sheets).toEqual([
      { top: 0, width: 800, height: 1000, orientation: 'portrait', rotated: false },
      { top: 1020, width: 1000, height: 800, orientation: 'landscape', rotated: true },
      { top: 1840, width: 800, height: 1000, orientation: 'portrait', rotated: false }
    ]);
    expect(Array.from(root.children).map(child => child.hasAttribute('data-doc-rotated'))).toEqual([
      false,
      false,
      true,
      true,
      false
    ]);
    expect(sheetIndexAt(sheets, 1500)).toBe(1);
    expect(serialize(root)).not.toContain('data-doc-rotated');
    stage.remove();
  });
});
