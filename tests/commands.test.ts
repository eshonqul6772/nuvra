import { describe, expect, it } from 'vitest';

import { getDocumentTemplate, templateVariableLabel } from '../src/core/document-templates';
import { DocumentEngine } from '../src/core/engine/engine';
import { formatAmountInWords } from '../src/core/numbers';

/** Creates an engine on a fresh editable element. */
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

/** Puts the caret into the first text node of the document at `offset`. */
const placeCaret = (engine: DocumentEngine, offset: number) => {
  const walker = document.createTreeWalker(engine.root, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

describe('transliterate command', () => {
  it('converts the whole document at a caret and keeps the formatting', () => {
    const engine = createEngine('<p><strong>O‘zbekiston</strong> Respublikasi</p><p>shahar</p>');
    placeCaret(engine, 0);
    engine.transliterate('toCyrillic');
    expect(engine.getHTML()).toBe('<p><strong>Ўзбекистон</strong> Республикаси</p><p>шаҳар</p>');
    engine.transliterate('toLatin');
    expect(engine.getHTML()).toBe('<p><strong>O‘zbekiston</strong> Respublikasi</p><p>shahar</p>');
  });

  it('can be undone', () => {
    const engine = createEngine('<p>choy</p>');
    placeCaret(engine, 0);
    engine.transliterate('toCyrillic');
    engine.undo();
    expect(engine.getHTML()).toBe('<p>choy</p>');
  });
});

describe('amount in words', () => {
  it('rewrites the number before the caret', () => {
    const engine = createEngine('<p>Jami 15 000 000 so‘m</p>');
    placeCaret(engine, 'Jami 15 000 000'.length);
    expect(engine.replaceAmount(value => formatAmountInWords(value))).toBe(true);
    expect(engine.getHTML()).toBe('<p>Jami 15 000 000 (o‘n besh million) so‘m</p>');
  });

  it('leaves text without an amount unchanged', () => {
    const engine = createEngine('<p>Jami so‘m</p>');
    placeCaret(engine, 4);
    expect(engine.replaceAmount(value => formatAmountInWords(value))).toBe(false);
    expect(engine.getHTML()).toBe('<p>Jami so‘m</p>');
  });
});

describe('insertContent', () => {
  it('starts blocks on a new line after a non-empty paragraph', () => {
    const engine = createEngine('<h1>Title</h1>');
    placeCaret(engine, 5);
    engine.insertContent('<p>First</p><p>Second</p>', { asBlocks: true });
    expect(engine.getHTML()).toBe('<h1>Title</h1><p>First</p><p>Second</p><p></p>');
  });

  it('adds no empty line before following content', () => {
    const engine = createEngine('<h1>Title</h1><p>Next</p>');
    placeCaret(engine, 5);
    engine.insertContent('<table data-type="signature"><tr><td><p>A</p></td></tr></table>', { asBlocks: true });
    expect(engine.getHTML()).toBe(
      '<h1>Title</h1><table data-type="signature"><tbody><tr><td><p>A</p></td></tr></tbody></table><p>Next</p>'
    );
  });

  it('flows into the line by default, like pasting', () => {
    const engine = createEngine('<p>Title</p>');
    placeCaret(engine, 5);
    engine.insertContent('<p> end</p>');
    expect(engine.getHTML()).toBe('<p>Title end</p>');
  });
});

describe('document templates', () => {
  it.each(['letter', 'order', 'application', 'certificate', 'act'] as const)('%s loads in every language', id => {
    for (const locale of ['uz', 'uz-Cyrl', 'ru', 'en'] as const) {
      const template = getDocumentTemplate(id, locale);
      const engine = createEngine(template.html);
      expect(engine.getVariables().sort()).toEqual(template.variables.map(variable => variable.name).sort());
      expect(template.variables.every(variable => variable.label !== variable.name)).toBe(true);
    }
  });

  it('writes Uzbek Cyrillic templates and labels', () => {
    expect(getDocumentTemplate('order', 'uz-Cyrl').html).toContain('БУЙРУҚ');
    expect(getDocumentTemplate('order', 'uz-Cyrl').html).toContain('{{doc_number}}');
    expect(templateVariableLabel('full_name', 'uz-Cyrl')).toBe('Ф.И.Ш.');
  });
});
