import type { EditorLabelKey, EditorLocaleCode } from './labels';
import type { TemplateVariable } from './templates';
import { transliterate } from './transliterate';

/** Built-in document templates. */
export type DocumentTemplateId = 'letter' | 'order' | 'application' | 'certificate' | 'act';

/** Languages the template texts are written in; Uzbek Cyrillic is converted from Uzbek Latin. */
type TemplateLanguage = 'uz' | 'ru' | 'en';

/** A document template ready to be inserted into the editor. */
export interface DocumentTemplate {
  /** Template identifier. */
  id: DocumentTemplateId;
  /** Document HTML with template variables. */
  html: string;
  /** Variables the template uses, with labels in the requested language. */
  variables: TemplateVariable[];
}

/** Labels of the variables the built-in templates use. */
const VARIABLE_LABELS: Record<string, Record<TemplateLanguage, string>> = {
  org_name: { uz: 'Tashkilot nomi', ru: 'Наименование организации', en: 'Organization name' },
  org_address: { uz: 'Tashkilot manzili', ru: 'Адрес организации', en: 'Organization address' },
  doc_number: { uz: 'Hujjat raqami', ru: 'Номер документа', en: 'Document number' },
  doc_date: { uz: 'Hujjat sanasi', ru: 'Дата документа', en: 'Document date' },
  city: { uz: 'Shahar', ru: 'Город', en: 'City' },
  recipient: { uz: 'Qabul qiluvchi', ru: 'Адресат', en: 'Recipient' },
  subject: { uz: 'Mavzu', ru: 'Тема', en: 'Subject' },
  signer_position: { uz: 'Imzolovchi lavozimi', ru: 'Должность подписанта', en: 'Signer’s position' },
  signer_name: { uz: 'Imzolovchi F.I.Sh.', ru: 'Ф.И.О. подписанта', en: 'Signer’s name' },
  executor: { uz: 'Ijrochi', ru: 'Исполнитель', en: 'Prepared by' },
  full_name: { uz: 'F.I.Sh.', ru: 'Ф.И.О.', en: 'Full name' },
  position: { uz: 'Lavozim', ru: 'Должность', en: 'Position' },
  address: { uz: 'Yashash manzili', ru: 'Адрес проживания', en: 'Home address' },
  phone: { uz: 'Telefon', ru: 'Телефон', en: 'Phone' }
};

/** A variable element as the editor saves it. */
const v = (name: string) => `<span data-variable="${name}">{{${name}}}</span>`;

/** A borderless layout table with one row. */
const row = (...cells: string[]) =>
  `<table data-type="signature"><tbody><tr>${cells.map(cell => `<td>${cell || '<p></p>'}</td>`).join('')}</tr></tbody></table>`;

/** A justified paragraph with a first line indent, as in official documents. */
const body = (text: string) => `<p style="text-align: justify; text-indent: 48px">${text}</p>`;

const center = (text: string) => `<p style="text-align: center">${text}</p>`;
const right = (text: string) => `<p style="text-align: right">${text}</p>`;
const title = (text: string) => `<h2 style="text-align: center">${text}</h2>`;
const LINE = '________________';

/** The signature row of the head of the organization. */
const signer = () => row(`<p>${v('signer_position')}</p>`, center(LINE), right(v('signer_name')));

/** Template HTML by language. */
const TEMPLATES: Record<DocumentTemplateId, Record<TemplateLanguage, string>> = {
  letter: {
    uz: [
      center(`<strong>${v('org_name')}</strong>`),
      center(`Manzil: ${v('org_address')}`),
      '<hr>',
      row(`<p>${v('doc_date')} № ${v('doc_number')}</p>`, right(`<strong>${v('recipient')}</strong>`)),
      `<p><em>${v('subject')} haqida</em></p>`,
      body('Hurmatli hamkasblar!'),
      body('Xat matnini shu yerga yozing.'),
      body('Hurmat bilan,'),
      signer(),
      `<p style="font-size: 10pt">Ijrochi: ${v('executor')}</p>`
    ].join(''),
    ru: [
      center(`<strong>${v('org_name')}</strong>`),
      center(`Адрес: ${v('org_address')}`),
      '<hr>',
      row(`<p>${v('doc_date')} № ${v('doc_number')}</p>`, right(`<strong>${v('recipient')}</strong>`)),
      `<p><em>О ${v('subject')}</em></p>`,
      body('Уважаемые коллеги!'),
      body('Напишите здесь текст письма.'),
      body('С уважением,'),
      signer(),
      `<p style="font-size: 10pt">Исп.: ${v('executor')}</p>`
    ].join(''),
    en: [
      center(`<strong>${v('org_name')}</strong>`),
      center(`Address: ${v('org_address')}`),
      '<hr>',
      row(`<p>${v('doc_date')} No. ${v('doc_number')}</p>`, right(`<strong>${v('recipient')}</strong>`)),
      `<p><em>Re: ${v('subject')}</em></p>`,
      body('Dear colleagues,'),
      body('Write the text of the letter here.'),
      body('Yours faithfully,'),
      signer(),
      `<p style="font-size: 10pt">Prepared by: ${v('executor')}</p>`
    ].join('')
  },
  order: {
    uz: [
      center(`<strong>${v('org_name')}</strong>`),
      title('BUYRUQ'),
      row(`<p>${v('doc_date')}</p>`, center(v('city')), right(`№ ${v('doc_number')}`)),
      center(`<strong>${v('subject')} to‘g‘risida</strong>`),
      body('Buyruq chiqarish uchun asosni shu yerga yozing.'),
      center('<strong>BUYURAMAN:</strong>'),
      '<ol><li><p>Birinchi topshiriq.</p></li><li><p>Ikkinchi topshiriq.</p></li><li><p>Mazkur buyruq ijrosini nazorat qilishni o‘z zimmamda qoldiraman.</p></li></ol>',
      signer()
    ].join(''),
    ru: [
      center(`<strong>${v('org_name')}</strong>`),
      title('ПРИКАЗ'),
      row(`<p>${v('doc_date')}</p>`, center(v('city')), right(`№ ${v('doc_number')}`)),
      center(`<strong>О ${v('subject')}</strong>`),
      body('Укажите здесь основание для издания приказа.'),
      center('<strong>ПРИКАЗЫВАЮ:</strong>'),
      '<ol><li><p>Первое поручение.</p></li><li><p>Второе поручение.</p></li><li><p>Контроль за исполнением настоящего приказа оставляю за собой.</p></li></ol>',
      signer()
    ].join(''),
    en: [
      center(`<strong>${v('org_name')}</strong>`),
      title('ORDER'),
      row(`<p>${v('doc_date')}</p>`, center(v('city')), right(`No. ${v('doc_number')}`)),
      center(`<strong>On ${v('subject')}</strong>`),
      body('State the grounds for this order here.'),
      center('<strong>I HEREBY ORDER:</strong>'),
      '<ol><li><p>First instruction.</p></li><li><p>Second instruction.</p></li><li><p>I reserve control over the execution of this order.</p></li></ol>',
      signer()
    ].join('')
  },
  application: {
    uz: [
      row(
        '',
        `<p>${v('recipient')}ga</p><p>${v('full_name')}dan</p><p>Manzil: ${v('address')}</p><p>Tel.: ${v('phone')}</p>`
      ),
      title('ARIZA'),
      body('Arizangiz matnini shu yerga yozing.'),
      row(`<p>${v('doc_date')}</p>`, right(`${LINE} ${v('full_name')}`))
    ].join(''),
    ru: [
      row(
        '',
        `<p>${v('recipient')}</p><p>от ${v('full_name')}</p><p>Адрес: ${v('address')}</p><p>Тел.: ${v('phone')}</p>`
      ),
      title('ЗАЯВЛЕНИЕ'),
      body('Напишите здесь текст заявления.'),
      row(`<p>${v('doc_date')}</p>`, right(`${LINE} ${v('full_name')}`))
    ].join(''),
    en: [
      row(
        '',
        `<p>To: ${v('recipient')}</p><p>From: ${v('full_name')}</p><p>Address: ${v('address')}</p><p>Phone: ${v('phone')}</p>`
      ),
      title('APPLICATION'),
      body('Write the text of your application here.'),
      row(`<p>${v('doc_date')}</p>`, right(`${LINE} ${v('full_name')}`))
    ].join('')
  },
  certificate: {
    uz: [
      center(`<strong>${v('org_name')}</strong>`),
      title('MA’LUMOTNOMA'),
      row(`<p>${v('doc_date')}</p>`, right(`№ ${v('doc_number')}`)),
      body(
        `Ushbu ma’lumotnoma ${v('full_name')}ga u haqiqatan ham ${v('org_name')}da ${v('position')} lavozimida ishlayotganligi haqida berildi.`
      ),
      body('Ma’lumotnoma talab qilingan joyga taqdim etish uchun berildi.'),
      signer(),
      '<p>M.O‘.</p>'
    ].join(''),
    ru: [
      center(`<strong>${v('org_name')}</strong>`),
      title('СПРАВКА'),
      row(`<p>${v('doc_date')}</p>`, right(`№ ${v('doc_number')}`)),
      body(
        `Настоящая справка выдана ${v('full_name')} в том, что он(а) действительно работает в ${v('org_name')} в должности ${v('position')}.`
      ),
      body('Справка выдана для предъявления по месту требования.'),
      signer(),
      '<p>М.П.</p>'
    ].join(''),
    en: [
      center(`<strong>${v('org_name')}</strong>`),
      title('CERTIFICATE OF EMPLOYMENT'),
      row(`<p>${v('doc_date')}</p>`, right(`No. ${v('doc_number')}`)),
      body(`This is to certify that ${v('full_name')} is employed by ${v('org_name')} as ${v('position')}.`),
      body('This certificate is issued upon request.'),
      signer(),
      '<p>Seal</p>'
    ].join('')
  },
  act: {
    uz: [
      title('DALOLATNOMA'),
      row(`<p>${v('doc_date')}</p>`, right(v('city'))),
      body('Biz, quyida imzo chekuvchi komissiya a’zolari, quyidagilar haqida ushbu dalolatnomani tuzdik:'),
      '<table><tbody><tr><th><p>№</p></th><th><p>Nomi</p></th><th><p>Soni</p></th><th><p>Izoh</p></th></tr><tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>',
      body('Komissiya xulosasi:'),
      row('<p>Komissiya raisi:</p><p>Komissiya a’zolari:</p>', `<p>${LINE}</p><p>${LINE}</p><p>${LINE}</p>`)
    ].join(''),
    ru: [
      title('АКТ'),
      row(`<p>${v('doc_date')}</p>`, right(v('city'))),
      body('Мы, нижеподписавшиеся члены комиссии, составили настоящий акт о нижеследующем:'),
      '<table><tbody><tr><th><p>№</p></th><th><p>Наименование</p></th><th><p>Количество</p></th><th><p>Примечание</p></th></tr><tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>',
      body('Заключение комиссии:'),
      row('<p>Председатель комиссии:</p><p>Члены комиссии:</p>', `<p>${LINE}</p><p>${LINE}</p><p>${LINE}</p>`)
    ].join(''),
    en: [
      title('ACT'),
      row(`<p>${v('doc_date')}</p>`, right(v('city'))),
      body('We, the undersigned members of the commission, have drawn up this act on the following:'),
      '<table><tbody><tr><th><p>No.</p></th><th><p>Item</p></th><th><p>Quantity</p></th><th><p>Note</p></th></tr><tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>',
      body('Conclusion of the commission:'),
      row(
        '<p>Chair of the commission:</p><p>Members of the commission:</p>',
        `<p>${LINE}</p><p>${LINE}</p><p>${LINE}</p>`
      )
    ].join('')
  }
};

/** Every built-in template with its menu label, in the order the menu lists them. */
export const DOCUMENT_TEMPLATES: ReadonlyArray<{ id: DocumentTemplateId; label: EditorLabelKey }> = [
  { id: 'letter', label: 'editor.templates.letter' },
  { id: 'order', label: 'editor.templates.order' },
  { id: 'application', label: 'editor.templates.application' },
  { id: 'certificate', label: 'editor.templates.certificate' },
  { id: 'act', label: 'editor.templates.act' }
];

/** Language whose texts a locale uses. */
const languageOf = (locale: EditorLocaleCode): TemplateLanguage => (locale === 'uz-Cyrl' ? 'uz' : locale);

/** Converts the text of Uzbek Latin HTML to Cyrillic, leaving tags, attributes and `{{name}}` untouched. */
const toCyrillicHtml = (html: string): string =>
  html
    .split(/(<[^>]*>)/)
    .map(part => (part.startsWith('<') ? part : transliterate(part, 'toCyrillic')))
    .join('');

/** Label of a built-in template variable in the editor's language, or `undefined` for other names. */
export const templateVariableLabel = (name: string, locale: EditorLocaleCode): string | undefined => {
  const labels = Object.hasOwn(VARIABLE_LABELS, name) ? VARIABLE_LABELS[name] : undefined;
  if (!labels) return undefined;
  const label = labels[languageOf(locale)];
  return locale === 'uz-Cyrl' ? transliterate(label, 'toCyrillic') : label;
};

/** A built-in document template in the editor's language, with the variables it uses. */
export const getDocumentTemplate = (id: DocumentTemplateId, locale: EditorLocaleCode = 'uz'): DocumentTemplate => {
  const source = TEMPLATES[id][languageOf(locale)];
  const html = locale === 'uz-Cyrl' ? toCyrillicHtml(source) : source;
  const names = [...new Set(Array.from(source.matchAll(/data-variable="([^"]+)"/g), match => match[1] ?? ''))];
  return {
    id,
    html,
    variables: names.map(name => ({ name, label: templateVariableLabel(name, locale) ?? name }))
  };
};
