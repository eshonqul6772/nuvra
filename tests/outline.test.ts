import { describe, expect, it } from 'vitest';

import { buildDocx } from '../src/core/docx/export';
import { readZip } from '../src/core/docx/zip';
import { DocumentEngine } from '../src/core/engine/engine';
import { buildTableOfContents, readOutline } from '../src/core/outline';
import { createPageSettings } from '../src/core/page';

const createEngine = (content: string) => {
  const root = document.createElement('div');
  document.body.append(root);
  return new DocumentEngine(root, {
    content,
    editable: true,
    maxLength: 0,
    placeholder: () => '',
    onImageFiles: () => undefined
  });
};

/** Puts the caret at the end of the last block. */
const caretAtEnd = (engine: DocumentEngine) => {
  const range = document.createRange();
  range.selectNodeContents(engine.root.lastElementChild as Element);
  range.collapse(false);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

const OPTIONS = { title: 'Mundarija', emptyText: 'Sarlavhalar yo‘q' };

describe('readOutline', () => {
  it('lists top-level headings with text, down to the depth', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<h1>Kirish</h1><p>matn</p><h2>  Maqsad\n va vazifalar </h2><h4>Chuqur</h4><h3></h3><table><tbody><tr><td><h2>Jadvalda</h2></td></tr></tbody></table>';
    expect(readOutline(root).map(({ level, text }) => [level, text])).toEqual([
      [1, 'Kirish'],
      [2, 'Maqsad va vazifalar'],
      [4, 'Chuqur']
    ]);
    expect(readOutline(root, 3)).toHaveLength(2);
  });
});

describe('buildTableOfContents', () => {
  it('writes the title, indented entries and page numbers', () => {
    const html = buildTableOfContents(
      [
        { level: 1, text: 'Kirish', page: 2 },
        { level: 2, text: 'A & B', page: 3 }
      ],
      { ...OPTIONS, width: 600 }
    );
    expect(html).toContain('<table data-type="toc"><colgroup><col style="width: 544px"><col style="width: 56px">');
    expect(html).toContain('<strong>Mundarija</strong>');
    expect(html).toContain(
      '<tr><td><p><strong>Kirish</strong></p></td><td><p style="text-align: right">2</p></td></tr>'
    );
    expect(html).toContain('<p style="margin-left: 24px">A &amp; B</p>');
  });

  it('says so when there are no headings', () => {
    expect(buildTableOfContents([], OPTIONS)).toContain('<em>Sarlavhalar yo‘q</em>');
  });
});

describe('table of contents in the editor', () => {
  it('is inserted, kept by the sanitiser and replaced in place', () => {
    const engine = createEngine('<h1>Bir</h1><p>matn</p>');
    caretAtEnd(engine);
    engine.setTableOfContents(buildTableOfContents([{ level: 1, text: 'Bir', page: 1 }], OPTIONS));
    expect(engine.hasTableOfContents).toBe(true);
    expect(engine.getHTML()).toContain('<table data-type="toc">');
    expect(engine.getState().tableOfContents).toBe(true);

    engine.setTableOfContents(buildTableOfContents([{ level: 1, text: 'Bir', page: 7 }], OPTIONS));
    expect(engine.root.querySelectorAll('table[data-type="toc"]')).toHaveLength(1);
    expect(engine.getHTML()).toMatch(/<p style="text-align: right;?">7<\/p>/);

    engine.undo();
    expect(engine.getHTML()).toMatch(/<p style="text-align: right;?">1<\/p>/);
    engine.undo();
    expect(engine.hasTableOfContents).toBe(false);
  });

  it('joins a correction to the insertion when asked', () => {
    const engine = createEngine('<h1>Bir</h1><p>matn</p>');
    caretAtEnd(engine);
    engine.setTableOfContents(buildTableOfContents([{ level: 1, text: 'Bir', page: 1 }], OPTIONS));
    engine.setTableOfContents(buildTableOfContents([{ level: 1, text: 'Bir', page: 2 }], OPTIONS), {
      addToHistory: false
    });
    engine.undo();
    expect(engine.getHTML()).toBe('<h1>Bir</h1><p>matn</p>');
  });

  it('is exported to Word without borders', async () => {
    const html = buildTableOfContents([{ level: 1, text: 'Bir', page: 1 }], OPTIONS);
    const blob = await buildDocx({ html, title: 't', page: createPageSettings() });
    const document = new TextDecoder().decode((await readZip(await blob.arrayBuffer())).get('word/document.xml'));
    expect(document).toContain('w:val="none"');
    expect(document).not.toContain('w:val="single"');
  });
});
