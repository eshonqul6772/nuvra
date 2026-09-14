import { describe, expect, it } from 'vitest';

import { transliterate } from '../src/core/transliterate';

const toCyrillic = (text: string) => transliterate(text, 'toCyrillic');
const toLatin = (text: string) => transliterate(text, 'toLatin');

describe('transliterate to Cyrillic', () => {
  it.each([
    ['O‘zbekiston Respublikasi', 'Ўзбекистон Республикаси'],
    ['shahar, choy, g‘isht', 'шаҳар, чой, ғишт'],
    ["o'g'il", 'ўғил'],
    ['yo‘nalish, bo‘yoqcha', 'йўналиш, бўёқча'],
    ['yozuv, yulduz, yaxshi', 'ёзув, юлдуз, яхши'],
    ['ertaga ekran', 'эртага экран'],
    ['teatr', 'театр'],
    ['ma’lumot, san’at', 'маълумот, санъат'],
    ['SHAHAR TASDIQLAYMAN', 'ШАҲАР ТАСДИҚЛАЙМАН'],
    ['Shartnoma № 12', 'Шартнома № 12'],
    ['Sahifa {current} / {total}', 'Саҳифа {current} / {total}'],
    ['Hurmatli {{fio}}!', 'Ҳурматли {{fio}}!']
  ])('%s', (latin, cyrillic) => {
    expect(toCyrillic(latin)).toBe(cyrillic);
  });
});

describe('transliterate to Latin', () => {
  it.each([
    ['Ўзбекистон Республикаси', 'O‘zbekiston Respublikasi'],
    ['шаҳар, чой, ғишт', 'shahar, choy, g‘isht'],
    ['ёзув, юлдуз, яхши', 'yozuv, yulduz, yaxshi'],
    ['ер, шеър, поезд', 'yer, sheʼr, poyezd'],
    ['эртага', 'ertaga'],
    ['цирк, концерт, лицей', 'sirk, konsert, litsey'],
    ['ШАҲАР', 'SHAHAR'],
    ['Шаҳар', 'Shahar'],
    ['{count} сўз', '{count} so‘z']
  ])('%s', (cyrillic, latin) => {
    expect(toLatin(cyrillic)).toBe(latin);
  });

  it('continues a word from the previous character', () => {
    expect(transliterate('е', 'toLatin', 'т')).toBe('e');
    expect(transliterate('е', 'toLatin', ' ')).toBe('ye');
  });
});
