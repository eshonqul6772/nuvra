/**
 * Conversion of Uzbek text between the Latin and the Cyrillic alphabet, following the official correspondence of the
 * two alphabets. Placeholders such as `{count}` and `{{name}}` are left untouched.
 */

/** Direction of a conversion. */
export type TransliterationDirection = 'toCyrillic' | 'toLatin';

/** Apostrophes people type for the Uzbek ‘ and ʼ signs. */
const APOSTROPHES = "‘’ʻʼ'`";

/** The sign written after o and g (o‘, g‘). */
const TURNED_COMMA = '‘';

/** The tutuq belgisi (ʼ), the Latin form of the Cyrillic hard sign. */
const MODIFIER_APOSTROPHE = 'ʼ';

/** Vowels of both alphabets; after them `e` is written as `э`/`ye`. */
const VOWELS = new Set(Array.from('aeiouAEIOUаеёиоуэюяўАЕЁИОУЭЮЯЎ'));

/** Latin sequences of two letters with their Cyrillic letter, checked before single letters. */
const LATIN_DIGRAPHS: Record<string, string> = { sh: 'ш', ch: 'ч', yo: 'ё', yu: 'ю', ya: 'я', ye: 'е' };

/** Single Latin letters and their Cyrillic letter; `e` depends on its position and is handled separately. */
const LATIN_LETTERS: Record<string, string> = {
  a: 'а',
  b: 'б',
  d: 'д',
  f: 'ф',
  g: 'г',
  h: 'ҳ',
  i: 'и',
  j: 'ж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'қ',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  x: 'х',
  y: 'й',
  z: 'з'
};

/** Cyrillic letters and their Latin spelling; `е` and `ц` depend on their position and are handled separately. */
const CYRILLIC_LETTERS: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: MODIFIER_APOSTROPHE,
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: `o${TURNED_COMMA}`,
  қ: 'q',
  ғ: `g${TURNED_COMMA}`,
  ҳ: 'h'
};

/** Placeholders kept as they are: `{{name}}` and `{name}`. */
const PLACEHOLDER = /\{\{[^{}]*\}\}|\{[^{}]*\}/y;

/** Whether a character is a letter. */
const isLetter = (character: string | undefined): boolean => character !== undefined && /\p{L}/u.test(character);

/** Whether a letter is upper case. */
const isUpper = (character: string | undefined): boolean =>
  character !== undefined && character !== character.toLowerCase() && character === character.toUpperCase();

/**
 * Applies the case of the source letters to a converted spelling: an upper-case source gives an upper-case result,
 * except for a capitalised word (`Sh` in `Shahar`), where only the first letter is upper case.
 */
const matchCase = (source: string, next: string | undefined, converted: string): string => {
  if (!isUpper(source[0])) return converted;
  const wholeWordUpper = source.length > 1 ? isUpper(source[1]) : !isLetter(next) || isUpper(next);
  if (wholeWordUpper) return converted.toUpperCase();
  return (converted[0]?.toUpperCase() ?? '') + converted.slice(1);
};

/** Converts Latin text to Cyrillic. */
const latinToCyrillic = (text: string, previous: string): string => {
  let result = '';
  let index = 0;
  let before = previous;
  while (index < text.length) {
    PLACEHOLDER.lastIndex = index;
    const placeholder = PLACEHOLDER.exec(text);
    if (placeholder) {
      result += placeholder[0];
      index += placeholder[0].length;
      before = '}';
      continue;
    }
    const character = text[index] ?? '';
    const lower = character.toLowerCase();
    const next = text[index + 1];
    let consumed = 1;
    let converted: string;

    if ((lower === 'o' || lower === 'g') && next !== undefined && APOSTROPHES.includes(next)) {
      converted = lower === 'o' ? 'ў' : 'ғ';
      consumed = 2;
    } else if (
      next !== undefined &&
      LATIN_DIGRAPHS[lower + next.toLowerCase()] &&
      // In `yo‘l` the `o‘` is a letter of its own, so `y` stays `й`.
      !(lower === 'y' && APOSTROPHES.includes(text[index + 2] ?? '') && next.toLowerCase() === 'o')
    ) {
      converted = LATIN_DIGRAPHS[lower + next.toLowerCase()] ?? '';
      consumed = 2;
    } else if (lower === 'e') {
      converted = !isLetter(before) || VOWELS.has(before) ? 'э' : 'е';
    } else if (APOSTROPHES.includes(character) && isLetter(before) && isLetter(next)) {
      converted = 'ъ';
    } else {
      converted = LATIN_LETTERS[lower] ?? '';
      if (!converted) {
        result += character;
        before = character;
        index += 1;
        continue;
      }
    }
    const source = text.slice(index, index + consumed);
    result += matchCase(source, text[index + consumed], converted);
    before = converted.at(-1) ?? character;
    index += consumed;
  }
  return result;
};

/** Converts Cyrillic text to Latin. */
const cyrillicToLatin = (text: string, previous: string): string => {
  let result = '';
  let index = 0;
  let before = previous;
  while (index < text.length) {
    PLACEHOLDER.lastIndex = index;
    const placeholder = PLACEHOLDER.exec(text);
    if (placeholder) {
      result += placeholder[0];
      index += placeholder[0].length;
      before = '}';
      continue;
    }
    const character = text[index] ?? '';
    const lower = character.toLowerCase();
    let converted: string | undefined;
    if (lower === 'е') {
      converted = !isLetter(before) || VOWELS.has(before) ? 'ye' : 'e';
    } else if (lower === 'ц') {
      // `s` at the start of a word and after consonants (sirk, konsert), `ts` after vowels (litsey).
      converted = VOWELS.has(before) ? 'ts' : 's';
    } else {
      converted = CYRILLIC_LETTERS[lower];
    }
    if (converted === undefined) {
      result += character;
    } else {
      result += matchCase(character, text[index + 1], converted);
    }
    before = character;
    index += 1;
  }
  return result;
};

/**
 * Converts Uzbek text between the Latin and the Cyrillic alphabet. Letters of the other alphabet, digits, punctuation
 * and placeholders stay as they are.
 *
 * @param previous The character before `text`, when `text` continues earlier text; it decides the spelling of `e`.
 */
export const transliterate = (text: string, direction: TransliterationDirection, previous = ''): string =>
  direction === 'toCyrillic' ? latinToCyrillic(text, previous) : cyrillicToLatin(text, previous);
