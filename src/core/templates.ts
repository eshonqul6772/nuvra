/**
 * Template variables outside the editor. A saved document writes every variable as
 * `<span data-variable="name">{{name}}</span>`, so a template can be filled in the browser, on a Node server or by a
 * plain string replacement in any backend.
 */

/** A variable the user can insert into a template. */
export interface TemplateVariable {
  /** Name used in the saved HTML and in `{{name}}`: letters, digits, `_`, `.` and `-`. */
  name: string;
  /** Text the chip shows in the editor and the variable menu lists, for example `Full name`. */
  label: string;
}

/** Values for the variables of a template, by name. */
export type TemplateValues = Readonly<Record<string, string | number | null | undefined>>;

/** How {@link fillTemplate} treats a variable without a value. */
export interface FillTemplateOptions {
  /**
   * `keep` (the default) leaves the variable in place, so the result is still a template; `empty` removes it; `name`
   * writes `{{name}}` as plain text.
   */
  missing?: 'keep' | 'empty' | 'name';
}

/** A saved variable element with its name. Chips never contain other elements, so the content is plain text. */
const VARIABLE_ELEMENT = /<span\b[^>]*?\bdata-variable\s*=\s*(["'])([^"']*)\1[^>]*>[^<]*<\/span>/gi;

/** Characters escaped when a value is placed into HTML. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes a value for HTML; line breaks in the value become `<br>`. */
const toHtml = (value: string): string =>
  value.replace(/[&<>"']/g, character => HTML_ESCAPES[character] ?? character).replace(/\r\n?|\n/g, '<br>');

/**
 * Replaces the variables of a document saved by the editor with values. Values are escaped, so user input cannot
 * inject markup; the formatting around a variable (bold, font, colour) applies to its value.
 *
 * @param html Document HTML as saved by the editor.
 * @param values Values by variable name.
 */
export const fillTemplate = (html: string, values: TemplateValues, options: FillTemplateOptions = {}): string => {
  const missing = options.missing ?? 'keep';
  return html.replace(VARIABLE_ELEMENT, (element, _quote: string, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value !== undefined && value !== null) return toHtml(String(value));
    if (missing === 'empty') return '';
    return missing === 'name' ? toHtml(`{{${name}}}`) : element;
  });
};

/** Names of the variables a saved document uses, each once, in document order. */
export const getTemplateVariables = (html: string): string[] => {
  const names = Array.from(html.matchAll(VARIABLE_ELEMENT), match => match[2] ?? '');
  return [...new Set(names)].filter(Boolean);
};
