import { describe, expect, it } from 'vitest';

import { compareDocuments } from '../src/core/diff';

describe('compareDocuments', () => {
  it('reports identical versions', () => {
    const result = compareDocuments('<p>bir</p><h1>ikki</h1>', '<p>bir</p><h1>ikki</h1>');
    expect(result).toEqual({ html: '<p>bir</p><h1>ikki</h1>', insertions: 0, deletions: 0 });
  });

  it('marks changed words inside a paragraph and keeps its formatting attributes', () => {
    const result = compareDocuments(
      '<p style="text-align: center">Shartnoma 10 kun ichida bajariladi</p>',
      '<p style="text-align: center">Shartnoma 15 ish kuni ichida bajariladi</p>'
    );
    expect(result.html).toMatch(/^<p style="text-align: center;?">Shartnoma /);
    expect(result.html).toContain('<del class="doc-diff-del">10</del><ins class="doc-diff-ins">15</ins>');
    expect(result.html).toContain('<del class="doc-diff-del">kun</del><ins class="doc-diff-ins">ish kuni</ins>');
    expect(result.insertions).toBe(3);
    expect(result.deletions).toBe(2);
  });

  it('shows added and removed blocks whole', () => {
    const result = compareDocuments(
      '<p>bir</p><table><tbody><tr><td><p>eski</p></td></tr></tbody></table><p>uch</p>',
      '<p>bir</p><p>uch</p><ul><li><p>yangi band</p></li></ul>'
    );
    expect(result.html).toContain('<div class="doc-diff-block doc-diff-block--del"><table>');
    expect(result.html).toContain('<div class="doc-diff-block doc-diff-block--ins"><ul>');
    expect(result.deletions).toBe(1);
    expect(result.insertions).toBe(2);
  });

  it('escapes compared text', () => {
    const result = compareDocuments('<p>a &lt;b&gt;</p>', '<p>a &lt;i&gt;</p>');
    expect(result.html).toContain('<ins class="doc-diff-ins">&lt;i&gt;</ins>');
    expect(result.html).not.toContain('<i>');
  });
});
