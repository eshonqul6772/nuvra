import type { NumberWordsLocale } from './numbers';

/** Month names in the genitive-free form Uzbek and English documents use. */
const MONTHS = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  'uz-Cyrl': [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь'
  ],
  ru: [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря'
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]
} satisfies Record<NumberWordsLocale, string[]>;

/** Two-digit day or month. */
const twoDigits = (value: number) => String(value).padStart(2, '0');

/** A date as `dd.mm.yyyy`, the short form of Uzbek and Russian documents. */
export const formatShortDate = (date: Date): string =>
  `${twoDigits(date.getDate())}.${twoDigits(date.getMonth() + 1)}.${date.getFullYear()}`;

/**
 * A date written out as official documents do: `2026-yil 14-sentabr`, `2026 йил 14 сентябрь`, `14 сентября 2026 г.`
 * or `14 September 2026`.
 */
export const formatLongDate = (date: Date, locale: NumberWordsLocale = 'uz'): string => {
  const day = date.getDate();
  const month = MONTHS[locale][date.getMonth()] ?? '';
  const year = date.getFullYear();
  switch (locale) {
    case 'uz-Cyrl':
      return `${year} йил ${day} ${month}`;
    case 'ru':
      return `${day} ${month} ${year} г.`;
    case 'en':
      return `${day} ${month} ${year}`;
    default:
      return `${year}-yil ${day}-${month}`;
  }
};
