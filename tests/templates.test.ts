import { describe, expect, it } from 'vitest';

import { DocumentEngine } from '../src/core/engine/engine';
import { sanitizeHtml, serialize } from '../src/core/engine/schema';
import { buildSignatureBlock } from '../src/core/signature';
import { fillTemplate, getTemplateVariables } from '../src/core/templates';

/** Creates an engine on a fresh editable element. */
const createEngine = (content: string, known: string[] = []) => {
  const root = document.createElement('div');
  document.body.append(root);
  return new DocumentEngine(root, {
    content,
    editable: true,
    maxLength: 0,
    placeholder: () => '',
    onImageFiles: () => undefined,
    variableLabel: name => (known.includes(name) ? name.toUpperCase() : undefined)
  });
};

describe('fillTemplate', () => {
  const template =
    '<p>Dear <strong><span data-variable="name">{{name}}</span></strong>, № <span data-variable="no">{{no}}</span></p>';

  it('replaces variables with escaped values', () => {
    expect(fillTemplate(template, { name: '"A" <b>', no: 7 })).toBe(
      '<p>Dear <strong>&quot;A&quot; &lt;b&gt;</strong>, № 7</p>'
    );
  });

  it('keeps, removes or names missing variables', () => {
    expect(fillTemplate(template, { name: 'A' })).toContain('<span data-variable="no">{{no}}</span>');
    expect(fillTemplate(template, { name: 'A' }, { missing: 'empty' })).toBe('<p>Dear <strong>A</strong>, № </p>');
    expect(fillTemplate(template, {}, { missing: 'name' })).toBe('<p>Dear <strong>{{name}}</strong>, № {{no}}</p>');
  });

  it('turns line breaks into <br>', () => {
    expect(fillTemplate(template, { name: 'a\nb', no: 1 })).toContain('a<br>b');
  });

  it('lists the variables once, in document order', () => {
    expect(getTemplateVariables(`${template}<p><span data-variable="name">{{name}}</span></p>`)).toEqual([
      'name',
      'no'
    ]);
  });
});

describe('variable chips', () => {
  it('are rebuilt as empty atoms by the sanitiser and saved as {{name}}', () => {
    const fragment = sanitizeHtml('<p>x <span data-variable="fio" onclick="alert(1)">junk<b>x</b></span> y</p>');
    const root = document.createElement('div');
    root.append(fragment);
    const chip = root.querySelector('span[data-variable]');
    expect(chip?.getAttribute('contenteditable')).toBe('false');
    expect(chip?.childNodes.length).toBe(0);
    expect(serialize(root)).toBe('<p>x <span data-variable="fio">{{fio}}</span> y</p>');
  });

  it('drop invalid names', () => {
    const root = document.createElement('div');
    root.append(sanitizeHtml('<p><span data-variable="a b">t</span></p>'));
    expect(root.querySelector('span[data-variable]')).toBeNull();
  });

  it('keep a paragraph that holds only a variable', () => {
    const engine = createEngine('<p><span data-variable="fio">{{fio}}</span></p>');
    expect(engine.getHTML()).toBe('<p><span data-variable="fio">{{fio}}</span></p>');
    expect(engine.getVariables()).toEqual(['fio']);
  });

  it('show the host label, or {{name}} for unknown names', () => {
    const engine = createEngine('<p><span data-variable="fio"></span><span data-variable="x"></span></p>', ['fio']);
    const [known, unknown] = Array.from(engine.root.querySelectorAll('span[data-variable]'));
    expect(known?.getAttribute('data-label')).toBe('FIO');
    expect(unknown?.getAttribute('data-label')).toBe('{{x}}');
    expect(unknown?.classList.contains('is-unknown')).toBe(true);
  });
});

describe('signature blocks', () => {
  it('build borderless tables that survive sanitising', () => {
    const t = (key: string) => key.split('.').at(-1) ?? key;
    for (const preset of ['signer', 'approval', 'agreed', 'parties'] as const) {
      const root = document.createElement('div');
      root.append(sanitizeHtml(buildSignatureBlock(preset, t)));
      expect(root.querySelector('table')?.getAttribute('data-type')).toBe('signature');
    }
  });
});
