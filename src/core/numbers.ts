import { transliterate } from './transliterate';

/** Languages numbers can be written out in. */
export type NumberWordsLocale = 'uz' | 'uz-Cyrl' | 'ru' | 'en';

/** Largest whole number written out: just under a quadrillion. */
const MAX_WORDS_VALUE = 999_999_999_999_999;

const THOUSAND = 1000;
const HUNDRED = 100;
const TEN = 10;
const TEENS_END = 20;

/** Uzbek (Latin) numerals. */
const UZ = {
  ones: ['', 'bir', 'ikki', 'uch', 'to‘rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to‘qqiz'],
  tens: ['', 'o‘n', 'yigirma', 'o‘ttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'to‘qson'],
  scales: ['', 'ming', 'million', 'milliard', 'trillion'],
  zero: 'nol'
};

/** English numerals. */
const EN = {
  ones: [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen'
  ],
  tens: ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
  scales: ['', 'thousand', 'million', 'billion', 'trillion'],
  zero: 'zero'
};

/** Russian numerals; thousands are feminine, the other scales masculine. */
const RU = {
  ones: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  feminineOnes: ['', 'одна', 'две'],
  teens: [
    'десять',
    'одиннадцать',
    'двенадцать',
    'тринадцать',
    'четырнадцать',
    'пятнадцать',
    'шестнадцать',
    'семнадцать',
    'восемнадцать',
    'девятнадцать'
  ],
  tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
  hundreds: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
  /** Scale nouns as [one, two to four, five and more]. */
  scales: [
    ['', '', ''],
    ['тысяча', 'тысячи', 'тысяч'],
    ['миллион', 'миллиона', 'миллионов'],
    ['миллиард', 'миллиарда', 'миллиардов'],
    ['триллион', 'триллиона', 'триллионов']
  ],
  zero: 'ноль'
};

/** Splits a whole number into groups of three digits, lowest group first. */
const groupsOf = (value: number): number[] => {
  const groups: number[] = [];
  let rest = value;
  while (rest > 0) {
    groups.push(rest % THOUSAND);
    rest = Math.floor(rest / THOUSAND);
  }
  return groups;
};

/** Joins the words of every non-empty group from the highest scale down. */
const joinGroups = (value: number, groupWords: (group: number, scale: number) => string[]): string =>
  groupsOf(value)
    .map((group, scale) => (group ? groupWords(group, scale).filter(Boolean).join(' ') : ''))
    .reverse()
    .filter(Boolean)
    .join(' ');

/** A group of up to three digits in Uzbek: `bir yuz yigirma besh`. */
const uzbekGroup = (group: number): string[] => {
  const hundreds = Math.floor(group / HUNDRED);
  const tens = Math.floor((group % HUNDRED) / TEN);
  const ones = group % TEN;
  const words: string[] = [];
  if (hundreds) words.push(UZ.ones[hundreds] ?? '', 'yuz');
  if (tens) words.push(UZ.tens[tens] ?? '');
  if (ones) words.push(UZ.ones[ones] ?? '');
  return words;
};

/** A group of up to three digits in English: `one hundred twenty-five`. */
const englishGroup = (group: number): string[] => {
  const hundreds = Math.floor(group / HUNDRED);
  const rest = group % HUNDRED;
  const words: string[] = [];
  if (hundreds) words.push(EN.ones[hundreds] ?? '', 'hundred');
  if (rest >= TEENS_END) {
    const ones = rest % TEN;
    const tens = EN.tens[Math.floor(rest / TEN)] ?? '';
    words.push(ones ? `${tens}-${EN.ones[ones]}` : tens);
  } else if (rest) {
    words.push(EN.ones[rest] ?? '');
  }
  return words;
};

/** Russian plural form index for a number: 0 for one, 1 for two to four, 2 for the rest. */
const russianForm = (group: number): number => {
  const lastTwo = group % HUNDRED;
  const last = group % TEN;
  if (lastTwo >= 11 && lastTwo <= 14) return 2;
  if (last === 1) return 0;
  return last >= 2 && last <= 4 ? 1 : 2;
};

/** A group of up to three digits in Russian; `feminine` for thousands (`одна`, `две`). */
const russianGroup = (group: number, feminine: boolean): string[] => {
  const hundreds = Math.floor(group / HUNDRED);
  const rest = group % HUNDRED;
  const words: string[] = [];
  if (hundreds) words.push(RU.hundreds[hundreds] ?? '');
  if (rest >= TEN && rest < TEENS_END) {
    words.push(RU.teens[rest - TEN] ?? '');
  } else {
    const tens = Math.floor(rest / TEN);
    const ones = rest % TEN;
    if (tens) words.push(RU.tens[tens] ?? '');
    if (ones) words.push((feminine && ones <= 2 ? RU.feminineOnes[ones] : RU.ones[ones]) ?? '');
  }
  return words;
};

/**
 * Writes a whole number out in words, for example `15 000 000` as `o‘n besh million`. Fractions are dropped; negative
 * numbers get a minus word.
 *
 * @throws RangeError for values that are not finite or reach a quadrillion.
 */
export const numberToWords = (value: number, locale: NumberWordsLocale = 'uz'): string => {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_WORDS_VALUE) {
    throw new RangeError(`Cannot write ${value} in words`);
  }
  const whole = Math.trunc(Math.abs(value));
  const minus = value < 0 && whole > 0;
  if (locale === 'ru') {
    const words = whole
      ? joinGroups(whole, (group, scale) => [
          ...russianGroup(group, scale === 1),
          RU.scales[scale]?.[russianForm(group)] ?? ''
        ])
      : RU.zero;
    return minus ? `минус ${words}` : words;
  }
  if (locale === 'en') {
    const words = whole
      ? joinGroups(whole, (group, scale) => [...englishGroup(group), EN.scales[scale] ?? ''])
      : EN.zero;
    return minus ? `minus ${words}` : words;
  }
  const words = whole ? joinGroups(whole, (group, scale) => [...uzbekGroup(group), UZ.scales[scale] ?? '']) : UZ.zero;
  const uzbek = minus ? `minus ${words}` : words;
  return locale === 'uz-Cyrl' ? transliterate(uzbek, 'toCyrillic') : uzbek;
};

/** Hundredths in an amount. */
const CENTS = 100;

/** Writes the digits of a whole number in groups of three separated by spaces: `15 000 000`. */
const groupDigits = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * An amount with its digits grouped and the whole part in words, as written in contracts and payment documents:
 * `15 000 000 (o‘n besh million)`. Hundredths stay in digits: `1 250,50 (bir ming ikki yuz ellik)`.
 */
export const formatAmountInWords = (value: number, locale: NumberWordsLocale = 'uz'): string => {
  const cents = Math.round(Math.abs(value) * CENTS);
  const whole = Math.floor(cents / CENTS);
  const fraction = cents % CENTS;
  const sign = value < 0 && cents > 0 ? '-' : '';
  const digits = `${sign}${groupDigits(whole)}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''}`;
  return `${digits} (${numberToWords(sign ? -whole : whole, locale)})`;
};

/** An amount as people type it: digits grouped with spaces, dots or commas, and up to two decimals. */
const AMOUNT_TEXT = /^-?\d{1,3}(?:[   .,]?\d{3})*(?:[.,]\d{1,2})?$|^-?\d+(?:[.,]\d{1,2})?$/;

/**
 * Reads a typed amount such as `15 000 000`, `15000000`, `1 250,50` or `1,250.50`; `null` when the text is not an
 * amount. A separator followed by exactly three digits groups thousands; one or two digits at the end are decimals.
 */
export const parseAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (!AMOUNT_TEXT.test(trimmed)) return null;
  const decimals = /[.,](\d{1,2})$/.exec(trimmed);
  const wholePart = (decimals ? trimmed.slice(0, decimals.index) : trimmed).replace(/[   .,]/g, '');
  const value = Number(`${wholePart}${decimals ? `.${decimals[1]}` : ''}`);
  return Number.isFinite(value) && Math.abs(value) <= MAX_WORDS_VALUE ? value : null;
};
