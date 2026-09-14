import { describe, expect, it } from 'vitest';

import { collaboratorColor } from '../src/core/collaboration';
import { DocumentEngine } from '../src/core/engine/engine';

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

/** Puts the caret into the first text node at `offset`. */
const placeCaret = (engine: DocumentEngine, offset: number) => {
  const text = document.createTreeWalker(engine.root, NodeFilter.SHOW_TEXT).nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

describe('collaboration hooks', () => {
  it('report the selection as character positions', () => {
    const engine = createEngine('<p>bir</p><p>ikki</p>');
    const text = engine.root.querySelectorAll('p')[1]?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 3);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const offsets = engine.getSelectionOffsets();
    expect(offsets).not.toBeNull();
    expect((offsets?.focus ?? 0) - (offsets?.anchor ?? 0)).toBe(2);
  });

  it('keep the caret position when the content is replaced from outside', () => {
    const engine = createEngine('<p>Salom dunyo</p>');
    placeCaret(engine, 6);
    const before = engine.getSelectionOffsets();
    engine.setContent('<p>Salom dunyo!</p>', { keepSelection: true });
    expect(engine.getSelectionOffsets()).toEqual(before);
  });

  it('measure positions past the end of the document without failing', () => {
    const engine = createEngine('<p>ab</p>');
    expect(() => engine.getOffsetRects({ anchor: 50, focus: 99 })).not.toThrow();
  });

  it('give every collaborator a stable colour unless they have their own', () => {
    expect(collaboratorColor({ id: 'olim' })).toBe(collaboratorColor({ id: 'olim' }));
    expect(collaboratorColor({ id: 'olim', color: 'tomato' })).toBe('tomato');
    expect(collaboratorColor({ id: 'x' })).toMatch(/^#[\da-f]{6}$/);
  });
});
