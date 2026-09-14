import { describe, expect, it } from 'vitest';

import { createCommentId, sortComments } from '../src/core/comments';
import { DocumentEngine } from '../src/core/engine/engine';
import { sanitizeHtml, serialize } from '../src/core/engine/schema';

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

/** Selects characters `from`–`to` of the first text node of the document. */
const selectText = (engine: DocumentEngine, from: number, to: number) => {
  const walker = document.createTreeWalker(engine.root, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

const clean = (html: string) => {
  const root = document.createElement('div');
  root.append(sanitizeHtml(html));
  return serialize(root);
};

describe('comment anchors', () => {
  it('wrap the selected text and survive formatting', () => {
    const engine = createEngine('<p>Shartnoma matni</p>');
    selectText(engine, 0, 9);
    expect(engine.addComment('c1')).toBe(true);
    expect(engine.getHTML()).toBe('<p><span data-comment="c1">Shartnoma</span> matni</p>');
    expect(engine.getCommentIds()).toEqual(['c1']);

    engine.toggleMark('bold');
    expect(engine.getHTML()).toContain('data-comment="c1"');
    engine.clearFormatting();
    expect(engine.getHTML()).toBe('<p><span data-comment="c1">Shartnoma</span> matni</p>');
  });

  it('are refused without selected text or with an invalid id', () => {
    const engine = createEngine('<p>matn</p>');
    selectText(engine, 1, 1);
    expect(engine.addComment('c1')).toBe(false);
    selectText(engine, 0, 2);
    expect(engine.addComment('bad id')).toBe(false);
  });

  it('are removed with their comment, keeping the text, and can be undone', () => {
    const engine = createEngine('<p>bir ikki</p>');
    selectText(engine, 0, 3);
    engine.addComment('c1');
    engine.removeComment('c1');
    expect(engine.getHTML()).toBe('<p>bir ikki</p>');
    engine.undo();
    expect(engine.getCommentIds()).toEqual(['c1']);
  });

  it('report the comment at the selection and drop editor classes when saved', () => {
    const engine = createEngine('<p>bir ikki</p>');
    selectText(engine, 0, 3);
    engine.addComment('c1');
    engine.decorateComments(new Set(['c1']), 'c1');
    expect(engine.root.querySelector('span[data-comment]')?.className).toBe('is-resolved is-active');
    expect(engine.getHTML()).toBe('<p><span data-comment="c1">bir</span> ikki</p>');
    expect(engine.getState().comment).toBe('c1');
  });

  it('are kept by the sanitiser only with a valid id', () => {
    expect(clean('<p><span data-comment="c-1_a" style="color: red">x</span></p>')).toMatch(
      /^<p><span data-comment="c-1_a"><span style="color: red;?">x<\/span><\/span><\/p>$/
    );
    expect(clean('<p><span data-comment="a b" onclick="x()">x</span></p>')).toBe('<p>x</p>');
  });
});

describe('comment helpers', () => {
  it('create distinct valid ids', () => {
    const a = createCommentId();
    expect(a).toMatch(/^[\w-]+$/);
    expect(createCommentId()).not.toBe(a);
  });

  it('sort comments by anchor order, detached ones last', () => {
    const comment = (id: string) => ({ id, text: id, createdAt: '' });
    const sorted = sortComments([comment('x'), comment('b'), comment('a')], ['a', 'b']);
    expect(sorted.map(item => item.id)).toEqual(['a', 'b', 'x']);
  });
});
