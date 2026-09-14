import type { EditorLabelKey } from './labels';

/** Signature blocks offered by the toolbar. */
export type SignaturePreset = 'signer' | 'approval' | 'agreed' | 'parties';

/** Every preset, in the order the menu lists them. */
export const SIGNATURE_PRESETS: ReadonlyArray<{ value: SignaturePreset; label: EditorLabelKey }> = [
  { value: 'signer', label: 'editor.signature.signer' },
  { value: 'approval', label: 'editor.signature.approval' },
  { value: 'agreed', label: 'editor.signature.agreed' },
  { value: 'parties', label: 'editor.signature.parties' }
];

/** Blank line the signature is written on. */
const SIGNATURE_LINE = '________________';

/** Characters escaped when a label is placed into HTML. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML. */
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => HTML_ESCAPES[character] ?? character);

/** A paragraph with optional alignment and bold text. */
const paragraph = (text: string, { align, bold = false }: { align?: 'center' | 'right'; bold?: boolean } = {}) => {
  const content = bold ? `<strong>${escapeHtml(text)}</strong>` : escapeHtml(text);
  return `<p${align ? ` style="text-align: ${align}"` : ''}>${content}</p>`;
};

/** A borderless signature table with one row of cells. */
const signatureTable = (cells: string[]) =>
  `<table data-type="signature"><tbody><tr>${cells.map(cell => `<td>${cell || '<p></p>'}</td>`).join('')}</tr></tbody></table>`;

/**
 * HTML of a signature block in the editor's language. Every text in it is ordinary editable content: the user replaces
 * the position and name, or puts template variables there.
 *
 * @param t Translates the placeholder texts into the editor's language.
 */
export const buildSignatureBlock = (preset: SignaturePreset, t: (key: EditorLabelKey) => string): string => {
  const position = t('editor.signature.text.position');
  const name = t('editor.signature.text.name');
  const date = t('editor.signature.text.date');

  /** A "stamp" column: title, position, the line with the name and the date. */
  const stamp = (title: EditorLabelKey) =>
    [
      paragraph(t(title), { bold: true }),
      paragraph(position),
      paragraph(`${SIGNATURE_LINE} ${name}`),
      paragraph(date)
    ].join('');

  /** The details and signature of one party of a contract. */
  const party = (title: EditorLabelKey) =>
    [
      paragraph(t(title), { bold: true }),
      paragraph(t('editor.signature.text.organization')),
      paragraph(position),
      paragraph(`${SIGNATURE_LINE} ${name}`),
      paragraph(t('editor.signature.text.seal'))
    ].join('');

  switch (preset) {
    case 'approval':
      return signatureTable(['', stamp('editor.signature.text.approved')]);
    case 'agreed':
      return signatureTable([stamp('editor.signature.text.agreed'), '']);
    case 'parties':
      return signatureTable([party('editor.signature.text.customer'), party('editor.signature.text.contractor')]);
    default:
      return signatureTable([
        paragraph(position),
        paragraph(SIGNATURE_LINE, { align: 'center' }),
        paragraph(name, { align: 'right' })
      ]);
  }
};
