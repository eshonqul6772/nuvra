import { describe, expect, it } from 'vitest';

import { buildPrintableHtml } from '../src/core/export';
import { createPageSettings, pageNumberOf, showsRunningTexts } from '../src/core/page';

describe('page numbering', () => {
  it('counts from the first page number', () => {
    const page = { ...createPageSettings(), firstPageNumber: 5 };
    expect(pageNumberOf(page, 1)).toBe(5);
    expect(pageNumberOf(page, 3)).toBe(7);
    expect(pageNumberOf(createPageSettings(), 2)).toBe(2);
  });

  it('hides running texts only on the first page of a title page document', () => {
    const page = { ...createPageSettings(), differentFirstPage: true };
    expect(showsRunningTexts(page, 1)).toBe(false);
    expect(showsRunningTexts(page, 2)).toBe(true);
    expect(showsRunningTexts(createPageSettings(), 1)).toBe(true);
  });

  it('prints sheets with the numbering and the title page', () => {
    const page = {
      ...createPageSettings(),
      footer: { left: '', center: '{page} / {pages}', right: '' },
      differentFirstPage: true,
      firstPageNumber: 0
    };
    const html = buildPrintableHtml({ html: '', pages: ['<p>a</p>', '<p>b</p>', '<p>c</p>'], title: 't', page });
    const footers = [...html.matchAll(/doc-running--footer"><span><\/span><span>([^<]*)<\/span>/g)].map(
      match => match[1]
    );
    expect(footers).toEqual(['1 / 3', '2 / 3']);
  });
});
