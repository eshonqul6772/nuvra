import { createApp, h, nextTick } from 'vue';
import { describe, expect, it } from 'vitest';

import DocumentEditor from '../src/components/document-editor.vue';
import type { ToolbarTool } from '../src/core/types';

/** Mounts the editor with a list of toolbar tools and returns the accessible names of the toolbar's controls. */
const toolbarLabels = async (tools?: readonly ToolbarTool[]) => {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render: () => h(DocumentEditor, { locale: 'en', modelValue: '<p>Text</p>', tools }) });
  app.mount(host);
  for (let index = 0; index < 3; index += 1) {
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const toolbar = host.querySelector('.doc-toolbar');
  const labels = Array.from(toolbar?.querySelectorAll('button, input') ?? [], control =>
    (control.getAttribute('aria-label') ?? control.getAttribute('title') ?? '').replace(/\s*\(.*\)$/, '')
  ).filter(Boolean);
  const dividers = toolbar?.querySelectorAll('.doc-toolbar__divider').length ?? 0;
  app.unmount();
  host.remove();
  return { labels, dividers };
};

describe('toolbar tools', () => {
  it('shows every tool without a list', async () => {
    const { labels, dividers } = await toolbarLabels();
    expect(labels).toEqual(expect.arrayContaining(['Undo', 'Bold', 'Insert table', 'Page setup', 'More']));
    expect(dividers).toBe(4);
  });

  it('shows only the listed tools and no dividers around empty groups', async () => {
    const { labels, dividers } = await toolbarLabels(['history', 'marks']);
    expect(labels).toEqual(expect.arrayContaining(['Undo', 'Redo', 'Bold', 'Italic', 'Underline']));
    expect(labels).not.toContain('Insert table');
    expect(labels).not.toContain('Page setup');
    expect(labels).not.toContain('More');
    expect(labels).not.toContain('Font size');
    expect(dividers).toBe(1);
  });

  it('leaves the toolbar empty for an empty list', async () => {
    const { labels, dividers } = await toolbarLabels([]);
    expect(labels).toEqual([]);
    expect(dividers).toBe(0);
  });
});
