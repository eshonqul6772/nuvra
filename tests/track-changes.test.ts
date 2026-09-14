import { describe, expect, it } from 'vitest';

import { buildDocx } from '../src/core/docx/export';
import { readDocx } from '../src/core/docx/import';
import { readZip } from '../src/core/docx/zip';
import { DocumentEngine } from '../src/core/engine/engine';
import { sanitizeHtml, serialize } from '../src/core/engine/schema';
import { createPageSettings } from '../src/core/page';

const createEngine = (content: string) => {
  const root = document.createElement('div');
  document.body.append(root);
  const engine = new DocumentEngine(root, {
    content,
    editable: true,
    maxLength: 0,
    placeholder: () => '',
    onImageFiles: () => undefined
  });
  root.focus();
  return engine;
};

/** Selects characters `from`–`to` of the first text node. */
const select = (engine: DocumentEngine, from: number, to = from) => {
  const text = document.createTreeWalker(engine.root, NodeFilter.SHOW_TEXT).nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

/** Saved HTML without the attributes that change on every run. */
const html = (engine: DocumentEngine) =>
  engine
    .getHTML()
    .replace(/ data-change="[^"]*"/g, '')
    .replace(/ data-time="[^"]*"/g, '');

/** Sends the input a key press would send. */
const input = (engine: DocumentEngine, inputType: string, data: string | null = null) =>
  engine.root.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));

describe('tracked changes', () => {
  it('marks typed text as inserted by the author, as one insertion', () => {
    const engine = createEngine('<p>Shartnoma</p>');
    engine.setTrackChanges(true, 'Aziz');
    select(engine, 9);
    input(engine, 'insertText', ' ');
    input(engine, 'insertText', 'N');
    input(engine, 'insertText', '1');
    expect(html(engine)).toBe('<p>Shartnoma<ins data-author="Aziz"> N1</ins></p>');
    expect(engine.getChanges()).toMatchObject([{ type: 'insert', author: 'Aziz', text: ' N1' }]);
  });

  it('marks deleted text instead of removing it, and removes own insertions for real', () => {
    const engine = createEngine('<p>bir ikki</p>');
    engine.setTrackChanges(true, 'Aziz');
    select(engine, 0, 3);
    input(engine, 'deleteContentBackward');
    expect(html(engine)).toBe('<p><del data-author="Aziz">bir</del> ikki</p>');

    engine.setTrackChanges(true, 'Olim');
    engine.insertText('uch');
    expect(html(engine)).toMatch(/^<p><del data-author="Aziz">bir<\/del><ins data-author="Olim">uch<\/ins> ikki<\/p>$/);
    input(engine, 'deleteContentBackward');
    expect(html(engine)).toBe('<p><del data-author="Aziz">bir</del><ins data-author="Olim">uc</ins> ikki</p>');
  });

  it('replaces a selection with a deletion followed by the typed text', () => {
    const engine = createEngine('<p>10 kun</p>');
    engine.setTrackChanges(true, 'A');
    select(engine, 0, 2);
    input(engine, 'insertText', '15');
    expect(html(engine)).toBe('<p><del data-author="A">10</del><ins data-author="A">15</ins> kun</p>');
    // Counts describe the document as it reads once the changes are accepted.
    expect(engine.getStats()).toEqual({ characters: 6, words: 2 });
  });

  it('steps over text that is already deleted', () => {
    const engine = createEngine('<p>ab<del data-change="x" data-author="B">cd</del></p>');
    engine.setTrackChanges(true, 'A');
    const paragraph = engine.root.querySelector('p') as HTMLElement;
    const caret = document.createRange();
    caret.setStart(paragraph, paragraph.childNodes.length);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(caret);
    input(engine, 'deleteContentBackward');
    input(engine, 'deleteContentBackward');
    input(engine, 'deleteContentBackward');
    expect(html(engine)).toBe('<p>a<del data-author="A">b</del><del data-author="B">cd</del></p>');
  });

  it('accepts and rejects changes one by one or all at once, as undo steps', () => {
    const source =
      '<p><del data-change="d1" data-author="A" data-time="2026-09-14T10:00:00Z">eski</del><ins data-change="i1" data-author="A" data-time="2026-09-14T10:00:00Z">yangi</ins> matn</p>';
    const engine = createEngine(source);
    engine.resolveChanges(true, 'd1');
    expect(html(engine)).toBe('<p><ins data-author="A">yangi</ins> matn</p>');
    engine.resolveChanges(false);
    expect(html(engine)).toBe('<p> matn</p>');
    engine.undo();
    engine.undo();
    expect(engine.getHTML()).toBe(source);
    engine.resolveChanges(true);
    expect(engine.getHTML()).toBe('<p>yangi matn</p>');
  });

  it('does not track while tracking is off, and pastes tracked', () => {
    const engine = createEngine('<p>a</p>');
    select(engine, 1);
    engine.insertText('b');
    expect(engine.getHTML()).toBe('<p>ab</p>');
    engine.setTrackChanges(true, 'A');
    expect(engine.tracksChanges).toBe(true);
    engine.insertContent('<strong>qalin</strong>');
    expect(html(engine)).toBe('<p>ab<strong><ins data-author="A">qalin</ins></strong></p>');
  });

  it('are written to Word as revisions and read back', async () => {
    const source =
      '<p><del data-change="d1" data-author="A" data-time="2026-09-14T10:00:00Z">10</del><ins data-change="i1" data-author="B" data-time="2026-09-14T10:00:00Z"><strong>15</strong></ins> kun</p>';
    const blob = await buildDocx({ html: source, title: 't', page: createPageSettings() });
    const document = new TextDecoder().decode((await readZip(await blob.arrayBuffer())).get('word/document.xml'));
    expect(document).toContain(
      '<w:del w:id="1" w:author="A" w:date="2026-09-14T10:00:00Z"><w:r><w:delText xml:space="preserve">10</w:delText></w:r></w:del>'
    );
    expect(document).toContain(
      '<w:ins w:id="2" w:author="B" w:date="2026-09-14T10:00:00Z"><w:r><w:rPr><w:b/><w:bCs/></w:rPr>'
    );

    const { html: imported } = await readDocx(await blob.arrayBuffer());
    const engine = createEngine(imported);
    expect(html(engine)).toBe('<p><del data-author="A">10</del><ins data-author="B"><strong>15</strong></ins> kun</p>');
    engine.resolveChanges(true);
    expect(engine.getHTML()).toBe('<p><strong>15</strong> kun</p>');
  });

  it('reads text Word marked as moved as a deletion and an insertion', async () => {
    const { createZip } = await import('../src/core/docx/zip');
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const documentXml = `<w:document xmlns:w="${w}"><w:body><w:p><w:moveFrom w:id="1" w:author="A" w:date="2026-09-14T10:00:00Z"><w:r><w:t>eski</w:t></w:r></w:moveFrom><w:r><w:t> joy </w:t></w:r><w:moveTo w:id="2" w:author="A" w:date="2026-09-14T10:00:00Z"><w:r><w:t>eski</w:t></w:r></w:moveTo></w:p></w:body></w:document>`;
    const data = createZip([{ name: 'word/document.xml', data: new TextEncoder().encode(documentXml) }]);
    const engine = createEngine((await readDocx(data)).html);
    expect(html(engine)).toBe('<p><del data-author="A">eski</del> joy <ins data-author="A">eski</ins></p>');
  });

  it('keeps tracked changes through the sanitiser, other ins and del are formatting', () => {
    const clean = (value: string) => {
      const root = document.createElement('div');
      root.append(sanitizeHtml(value));
      return serialize(root);
    };
    expect(
      clean(
        '<p><ins data-change="a1" data-author="X" data-time="bad" onclick="x()">y</ins><ins>z</ins><del>w</del></p>'
      )
    ).toBe('<p><ins data-change="a1" data-author="X" data-time="">y</ins><u>z</u><s>w</s></p>');
  });
});
