import { describe, expect, it } from 'vitest';

import { buildDocx } from '../src/core/docx/export';
import { readDocx } from '../src/core/docx/import';
import { readZip } from '../src/core/docx/zip';
import { DocumentEngine } from '../src/core/engine/engine';
import { sanitizeHtml, serialize } from '../src/core/engine/schema';
import { buildPrintableHtml } from '../src/core/export';
import { footnotesHtml } from '../src/core/footnotes';
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

/** Puts the caret into the first text node at `offset`. */
const placeCaret = (engine: DocumentEngine, offset: number) => {
  const text = document.createTreeWalker(engine.root, NodeFilter.SHOW_TEXT).nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

const clean = (html: string) => {
  const root = document.createElement('div');
  root.append(sanitizeHtml(html));
  return serialize(root);
};

describe('footnote references', () => {
  it('are saved with their text and document-wide numbers', () => {
    expect(
      clean('<p>a<sup data-footnote="Birinchi">9</sup> b<sup data-footnote="Ikkinchi &amp; oxirgi"></sup></p>')
    ).toBe('<p>a<sup data-footnote="Birinchi">1</sup> b<sup data-footnote="Ikkinchi &amp; oxirgi">2</sup></p>');
  });

  it('are inserted, edited, removed and undone as single steps', () => {
    const engine = createEngine('<p>Qonun</p>');
    placeCaret(engine, 5);
    const reference = engine.insertFootnote('') as HTMLElement;
    expect(reference).not.toBeNull();
    engine.setFootnoteText(reference, 'O‘zbekiston Respublikasi Qonuni');
    expect(engine.getHTML()).toBe('<p>Qonun<sup data-footnote="O‘zbekiston Respublikasi Qonuni">1</sup></p>');
    expect(engine.getFootnotes().map(note => note.text)).toEqual(['O‘zbekiston Respublikasi Qonuni']);

    engine.undo();
    expect(engine.getHTML()).toBe('<p>Qonun<sup data-footnote="">1</sup></p>');
    engine.redo();
    const current = engine.getFootnotes()[0]?.element as HTMLElement;
    engine.removeFootnote(current);
    expect(engine.getHTML()).toBe('<p>Qonun</p>');
  });

  it('are atoms that formatting commands leave in place', () => {
    const engine = createEngine('<p>a<sup data-footnote="x"></sup></p>');
    expect(engine.root.querySelector('sup')?.getAttribute('contenteditable')).toBe('false');
    placeCaret(engine, 1);
    engine.selectAll();
    engine.toggleMark('bold');
    engine.clearFormatting();
    expect(engine.getHTML()).toBe('<p>a<sup data-footnote="x">1</sup></p>');
  });
});

describe('footnote notes', () => {
  it('are written escaped with their numbers', () => {
    expect(footnotesHtml([{ number: 3, text: 'a <b>' }])).toBe(
      '<div class="doc-footnotes"><p><sup>3</sup> a &lt;b&gt;</p></div>'
    );
    expect(footnotesHtml([])).toBe('');
  });

  it('are printed at the bottom of their sheet', () => {
    const html = buildPrintableHtml({
      html: '',
      pages: ['<p>a<sup data-footnote="Bir">1</sup></p>', '<p>b</p>'],
      footnotes: [[{ number: 1, text: 'Bir' }], []],
      title: 't',
      page: createPageSettings()
    });
    expect(html.match(/doc-sheet__notes/g)).toHaveLength(2);
    expect(html).toContain(
      '<div class="doc-sheet__notes"><div class="doc-footnotes"><p><sup>1</sup> Bir</p></div></div>'
    );
  });
});

describe('footnotes in Word files', () => {
  it('are exported as Word footnotes and read back', async () => {
    const blob = await buildDocx({
      html: '<p>Matn<sup data-footnote="Birinchi izoh">1</sup> va<sup data-footnote="Ikkinchi">2</sup></p>',
      title: 't',
      page: createPageSettings()
    });
    const files = await readZip(await blob.arrayBuffer());
    const part = (name: string) => new TextDecoder().decode(files.get(name));
    expect(part('word/document.xml')).toContain('<w:footnoteReference w:id="2"/>');
    expect(part('word/footnotes.xml')).toContain('<w:t xml:space="preserve"> Birinchi izoh</w:t>');
    expect(part('word/_rels/document.xml.rels')).toContain('Target="footnotes.xml"');
    expect(part('[Content_Types].xml')).toContain('/word/footnotes.xml');
    expect(part('word/styles.xml')).toContain('w:styleId="FootnoteReference"');

    const result = await readDocx(await blob.arrayBuffer());
    expect(clean(result.html)).toBe(
      '<p>Matn<sup data-footnote="Birinchi izoh">1</sup> va<sup data-footnote="Ikkinchi">2</sup></p>'
    );
  });

  it('adds no footnotes part to documents without footnotes', async () => {
    const blob = await buildDocx({ html: '<p>x<sup>2</sup></p>', title: 't', page: createPageSettings() });
    const files = await readZip(await blob.arrayBuffer());
    expect(files.has('word/footnotes.xml')).toBe(false);
  });
});
