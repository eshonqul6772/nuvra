import { afterEach, describe, expect, it } from 'vitest';

import type { SheetFootnote } from '../src/core/footnotes';
import type { PageMetrics } from '../src/core/page';
import { createPagination } from '../src/core/pagination';

/** A sheet 1000px high with 100px margins and a 20px gap: the text area is 800px. */
const METRICS: PageMetrics = {
  width: 800,
  height: 1000,
  gap: 20,
  marginTop: 100,
  marginRight: 100,
  marginBottom: 100,
  marginLeft: 100
};

/** Height of every block, and of a measured notes block. */
const BLOCK_HEIGHT = 400;
const NOTES_HEIGHT = 200;

const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
});

/** Lays out paragraphs stacked from the top margin and reports the result of one layout pass. */
const layout = async (html: string) => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.querySelector(':scope > .doc-footnotes')) return NOTES_HEIGHT;
      return this.tagName === 'P' ? BLOCK_HEIGHT : 0;
    }
  });
  const stage = document.createElement('div');
  const root = document.createElement('div');
  root.innerHTML = html;
  stage.append(root);
  document.body.append(stage);
  Array.from(root.children).forEach((child, index) => {
    Object.defineProperty(child, 'offsetTop', {
      configurable: true,
      get: () => METRICS.marginTop + index * BLOCK_HEIGHT
    });
  });
  let pageCount = 1;
  let footnotes: SheetFootnote[][] = [];
  const pagination = createPagination(root, {
    onPageCount: count => {
      pageCount = count;
    },
    onFootnotes: sheets => {
      footnotes = sheets;
    },
    isComposing: () => false
  });
  pagination.setMetrics(METRICS);
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await new Promise(resolve => setTimeout(resolve, 20));
  pagination.destroy();
  const moved = Array.from(root.children).map(child => child.hasAttribute('data-doc-gap'));
  stage.remove();
  return { pageCount, footnotes, moved };
};

describe('pagination with footnotes', () => {
  it('fills a sheet when there are no footnotes', async () => {
    const result = await layout('<p>a</p><p>b</p><p>c</p>');
    expect(result.pageCount).toBe(2);
    expect(result.moved).toEqual([false, false, true]);
    expect(result.footnotes).toEqual([[], []]);
  });

  it('keeps space for the notes at the bottom of the sheet their reference is on', async () => {
    const result = await layout('<p>a</p><p>b<sup data-footnote="Izoh"></sup></p><p>c</p>');
    // The second block no longer fits above its note, so it starts the next sheet together with the note; the note
    // then leaves no room for the third block on that sheet either.
    expect(result.moved).toEqual([false, true, true]);
    expect(result.pageCount).toBe(3);
    expect(result.footnotes).toEqual([[], [{ number: 1, text: 'Izoh' }], []]);
  });

  it('numbers footnotes through the whole document', async () => {
    const result = await layout(
      '<p>a<sup data-footnote="Bir"></sup></p><p>b</p><p>c<sup data-footnote="Ikki"></sup></p>'
    );
    expect(result.footnotes.flat()).toEqual([
      { number: 1, text: 'Bir' },
      { number: 2, text: 'Ikki' }
    ]);
  });
});
