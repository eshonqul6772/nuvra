import { createApp, h, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';

import DocumentEditor from '../src/components/document-editor.vue';
import type { DocumentComment } from '../src/core/comments';
import type { DocumentEngine } from '../src/core/engine/engine';

/** Waits for Vue updates and a couple of animation frames. */
const settle = async () => {
  for (let index = 0; index < 3; index += 1) {
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

/** Mounts the full editor with comments enabled. */
const mountEditor = async (html: string) => {
  const content = ref(html);
  const comments = ref<DocumentComment[]>([]);
  const editor = ref<{ engine: DocumentEngine | null; updateTableOfContents: () => Promise<void> }>();
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(DocumentEditor, {
        ref: editor,
        locale: 'uz',
        author: 'Aziz',
        modelValue: content.value,
        'onUpdate:modelValue': (value: string) => {
          content.value = value;
        },
        comments: comments.value,
        'onUpdate:comments': (value: DocumentComment[]) => {
          comments.value = value;
        }
      })
  });
  app.mount(host);
  await settle();
  const engine = editor.value?.engine as DocumentEngine;
  return { host, content, comments, editor, engine, unmount: () => app.unmount() };
};

/** Clicks the toolbar button with the given accessible name. */
const clickButton = (host: HTMLElement, label: string) => {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    candidate => candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label
  );
  if (!button) throw new Error(`No button "${label}"`);
  button.click();
  return button;
};

/**
 * Opens the review menu of the toolbar and chooses an entry: the one whose text starts with `label` (entries may show
 * a shortcut after it), or with `exact` the one whose text is `label`.
 */
const chooseReview = async (host: HTMLElement, label: string, exact = false) => {
  clickButton(host, 'Taqriz: izohlar va o‘zgarishlar');
  await settle();
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('.doc-menu__item')).find(candidate => {
    const text = candidate.textContent?.trim() ?? '';
    return exact ? text === label : text.startsWith(label);
  });
  if (!item) throw new Error(`No review entry "${label}"`);
  item.click();
};

describe('DocumentEditor', () => {
  it('adds, replies to, resolves and deletes a comment', async () => {
    const { host, comments, engine, content, unmount } = await mountEditor('<p>Shartnoma matni</p>');
    const text = engine.root.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 9);
    engine.root.focus();
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    engine.getState();
    document.dispatchEvent(new Event('selectionchange'));
    await settle();

    await chooseReview(host, 'Izoh qo‘shish');
    await settle();
    const textarea = host.querySelector<HTMLTextAreaElement>('.doc-comments textarea');
    expect(textarea).not.toBeNull();
    (textarea as HTMLTextAreaElement).value = 'Muddatni aniqlashtiring';
    textarea?.dispatchEvent(new Event('input'));
    await nextTick();
    host.querySelector<HTMLFormElement>('.doc-comments form')?.requestSubmit();
    await settle();

    expect(comments.value).toHaveLength(1);
    expect(comments.value[0]).toMatchObject({ text: 'Muddatni aniqlashtiring', author: 'Aziz' });
    const id = comments.value[0]?.id as string;
    expect(engine.getHTML()).toBe(`<p><span data-comment="${id}">Shartnoma</span> matni</p>`);

    clickButton(host, 'Javob');
    await settle();
    const reply = host.querySelector<HTMLTextAreaElement>('.doc-comments__reply textarea') as HTMLTextAreaElement;
    reply.value = '10 kun';
    reply.dispatchEvent(new Event('input'));
    await nextTick();
    host.querySelector<HTMLFormElement>('.doc-comments__reply')?.requestSubmit();
    await settle();
    expect(comments.value[0]?.replies).toMatchObject([{ text: '10 kun', author: 'Aziz' }]);

    clickButton(host, 'Hal qilindi');
    await settle();
    expect(comments.value[0]?.resolved).toBe(true);
    expect(engine.root.querySelector('span[data-comment]')?.classList.contains('is-resolved')).toBe(true);

    clickButton(host, 'O‘chirish');
    await settle();
    expect(comments.value).toEqual([]);
    expect(engine.getHTML()).toBe('<p>Shartnoma matni</p>');
    expect(content.value).toBeDefined();
    unmount();
  });

  it('abandoning a new comment takes its anchor back', async () => {
    const { host, comments, engine, unmount } = await mountEditor('<p>bir ikki</p>');
    const text = engine.root.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    engine.root.focus();
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await settle();

    await chooseReview(host, 'Izoh qo‘shish');
    await settle();
    expect(engine.getCommentIds()).toHaveLength(1);
    const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>('.doc-comments button')).find(
      button => button.textContent?.trim() === 'Bekor qilish'
    );
    cancel?.click();
    await settle();
    expect(engine.getCommentIds()).toEqual([]);
    expect(comments.value).toEqual([]);
    unmount();
  });

  it('runs commands typed after a slash', async () => {
    const { host, engine, unmount } = await mountEditor('<p></p>');
    engine.focus('end');
    await settle();
    engine.insertText('/');
    await settle();
    expect(host.querySelectorAll('.doc-slash-menu [role="option"]').length).toBeGreaterThan(5);

    engine.insertText('sarlavha');
    await settle();
    const options = Array.from(host.querySelectorAll('.doc-slash-menu [role="option"]')).map(item =>
      item.textContent?.trim()
    );
    expect(options).toEqual(['Sarlavha 1', 'Sarlavha 2', 'Sarlavha 3']);

    engine.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    engine.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(host.querySelector('.doc-slash-menu')).toBeNull();
    expect(engine.getHTML()).toBe('<h2></h2><p></p>');

    engine.insertText('Kirish /');
    await settle();
    engine.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(host.querySelector('.doc-slash-menu')).toBeNull();
    expect(engine.getHTML()).toBe('<h2>Kirish /</h2><p></p>');
    unmount();
  });

  it('inserts a footnote from the slash menu and edits its note', async () => {
    const { host, engine, unmount } = await mountEditor('<p>Qonun</p>');
    engine.focus('end');
    await settle();
    engine.insertText(' /snoska');
    await settle();
    engine.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();

    const textarea = host.querySelector<HTMLTextAreaElement>('.doc-footnote-form textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    textarea.value = 'Birinchi izoh';
    textarea.dispatchEvent(new Event('input'));
    await nextTick();
    host.querySelector<HTMLFormElement>('.doc-footnote-form')?.requestSubmit();
    await settle();
    expect(host.querySelector('.doc-footnote-form')).toBeNull();
    expect(engine.getHTML()).toBe('<p>Qonun <sup data-footnote="Birinchi izoh">1</sup></p>');

    (engine.root.querySelector('sup[data-footnote]') as HTMLElement).click();
    await settle();
    clickButton(host, 'O‘chirish');
    await settle();
    expect(engine.getHTML()).toBe('<p>Qonun </p>');

    // A new footnote left without text is taken back.
    engine.focus('end');
    engine.insertText('/snoska');
    await settle();
    engine.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    clickButton(host, 'Bekor qilish');
    await settle();
    expect(engine.getFootnotes()).toEqual([]);
    unmount();
  });

  it('tracks changes from the toolbar and accepts them in the panel', async () => {
    const { host, engine, content, unmount } = await mountEditor('<p>10 kun</p>');
    await chooseReview(host, 'O‘zgarishlarni kuzatish');
    await settle();
    expect(engine.tracksChanges).toBe(true);

    const text = engine.root.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    engine.root.focus();
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    engine.insertText('15');
    await settle();
    expect(engine.getHTML()).toMatch(/^<p><del data-change="[^"]+" data-author="Aziz" data-time="[^"]+">10<\/del>/);

    await chooseReview(host, 'O‘zgarishlar', true);
    await settle();
    expect(Array.from(host.querySelectorAll('.doc-changes__card')).map(card => card.className)).toEqual([
      'doc-changes__card is-delete',
      'doc-changes__card is-insert'
    ]);
    clickButton(host, 'Hammasini qabul qilish');
    await settle();
    expect(engine.getHTML()).toBe('<p>15 kun</p>');
    expect(host.querySelector('.doc-changes__empty')).not.toBeNull();
    expect(content.value).toBeDefined();

    await chooseReview(host, 'O‘zgarishlarni kuzatish');
    await settle();
    expect(engine.tracksChanges).toBe(false);
    unmount();
  });

  it('lists headings in the navigation panel and inserts a table of contents', async () => {
    const { host, editor, engine, unmount } = await mountEditor('<h1>Kirish</h1><p>matn</p><h2>Maqsad</h2><p></p>');
    engine.focus('end');
    await settle();

    await editor.value?.updateTableOfContents();
    await settle();
    expect(engine.hasTableOfContents).toBe(true);
    expect(engine.root.querySelector('table[data-type="toc"]')?.textContent).toContain('Maqsad');

    const more = clickButton(host, 'Yana');
    await settle();
    const outlineItem = Array.from(document.querySelectorAll<HTMLButtonElement>('.doc-menu__item')).find(item =>
      item.textContent?.includes('Navigatsiya paneli')
    );
    expect(outlineItem, more.outerHTML).toBeDefined();
    outlineItem?.click();
    await settle();
    const headings = Array.from(host.querySelectorAll('.doc-outline__text')).map(item => item.textContent);
    expect(headings).toEqual(['Kirish', 'Maqsad']);
    unmount();
  });
});
