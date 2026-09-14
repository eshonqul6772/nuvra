import { createApp, h, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';

import DocumentForm from '../src/form.vue';

const TEMPLATE =
  '<p>Hurmatli <span data-variable="full_name">{{full_name}}</span>, <strong><span data-variable="doc_date">{{doc_date}}</span></strong></p><p><span data-variable="full_name">{{full_name}}</span></p>';

/** Mounts the form and returns its element, exposed methods and value. */
const mountForm = async (initial: Record<string, string> = {}) => {
  const values = ref(initial);
  const form = ref<{ getHTML: () => string; validate: () => string[] }>();
  const host = document.createElement('div');
  document.body.append(host);
  createApp({
    render: () =>
      h(DocumentForm, {
        ref: form,
        template: TEMPLATE,
        locale: 'uz',
        modelValue: values.value,
        'onUpdate:modelValue': (next: Record<string, string>) => {
          values.value = next;
        }
      })
  }).mount(host);
  await nextTick();
  return { host, values, form };
};

describe('DocumentForm', () => {
  it('turns every variable into a field labelled in the editor language', async () => {
    const { host } = await mountForm();
    const inputs = host.querySelectorAll<HTMLInputElement>('input[data-field]');
    expect(inputs).toHaveLength(3);
    expect(inputs[0]?.placeholder).toBe('F.I.Sh.');
    expect(inputs[1]?.closest('strong')).not.toBeNull();
  });

  it('shares one value between the fields of a variable and fills the template', async () => {
    const { host, values, form } = await mountForm();
    const first = host.querySelector<HTMLInputElement>('input[data-field="full_name"]') as HTMLInputElement;
    first.value = 'Aziz <Karimov>';
    first.dispatchEvent(new Event('input'));
    await nextTick();
    expect(values.value).toEqual({ full_name: 'Aziz <Karimov>' });
    const fields = host.querySelectorAll<HTMLInputElement>('input[data-field="full_name"]');
    expect(fields[1]?.value).toBe('Aziz <Karimov>');
    expect(form.value?.getHTML()).toContain('<p>Aziz &lt;Karimov&gt;</p>');
  });

  it('reports and marks the fields left empty', async () => {
    const { host, form } = await mountForm({ full_name: 'Aziz' });
    expect(form.value?.validate()).toEqual(['doc_date']);
    await nextTick();
    expect(host.querySelector('input[data-field="doc_date"]')?.classList.contains('is-invalid')).toBe(true);
  });
});
