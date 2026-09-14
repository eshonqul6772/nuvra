import { describe, expect, it } from 'vitest';

import { formatAmountInWords, numberToWords, parseAmount } from '../src/core/numbers';

describe('numberToWords', () => {
  it.each([
    [0, 'nol'],
    [7, 'yetti'],
    [15, 'o‘n besh'],
    [120, 'bir yuz yigirma'],
    [1250, 'bir ming ikki yuz ellik'],
    [15_000_000, 'o‘n besh million'],
    [2_000_001, 'ikki million bir'],
    [3_400_500_090, 'uch milliard to‘rt yuz million besh yuz ming to‘qson']
  ])('uz %i', (value, words) => {
    expect(numberToWords(value, 'uz')).toBe(words);
  });

  it.each([
    [0, 'ноль'],
    [1, 'один'],
    [1000, 'одна тысяча'],
    [2000, 'две тысячи'],
    [5000, 'пять тысяч'],
    [11_000, 'одиннадцать тысяч'],
    [21_000, 'двадцать одна тысяча'],
    [15_000_000, 'пятнадцать миллионов'],
    [1_234_567, 'один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь']
  ])('ru %i', (value, words) => {
    expect(numberToWords(value, 'ru')).toBe(words);
  });

  it.each([
    [0, 'zero'],
    [21, 'twenty-one'],
    [115, 'one hundred fifteen'],
    [15_000_000, 'fifteen million'],
    [1_000_250, 'one million two hundred fifty']
  ])('en %i', (value, words) => {
    expect(numberToWords(value, 'en')).toBe(words);
  });

  it('writes Uzbek Cyrillic', () => {
    expect(numberToWords(15_000_000, 'uz-Cyrl')).toBe('ўн беш миллион');
  });

  it('rejects values it cannot write', () => {
    expect(() => numberToWords(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => numberToWords(1e15)).toThrow(RangeError);
  });
});

describe('amounts', () => {
  it('formats digits and words', () => {
    expect(formatAmountInWords(15_000_000)).toBe('15 000 000 (o‘n besh million)');
    expect(formatAmountInWords(1250.5, 'ru')).toBe('1 250,50 (одна тысяча двести пятьдесят)');
  });

  it.each([
    ['15 000 000', 15_000_000],
    ['15000000', 15_000_000],
    ['1 250,50', 1250.5],
    ['1,250.50', 1250.5],
    ['1.250.000', 1_250_000],
    ['12,5', 12.5],
    ['abc', null],
    ['1 2', null]
  ])('parses %s', (text, value) => {
    expect(parseAmount(text)).toBe(value);
  });
});
