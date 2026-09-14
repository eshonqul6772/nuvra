import { describe, expect, it } from 'vitest';

import { buildPdf } from '../src/core/pdf';

/** Bytes of a tiny stand-in for JPEG data; the writer embeds pictures as they are. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

const page = (widthPt: number, heightPt: number) => ({ jpeg: JPEG, width: 4, height: 6, widthPt, heightPt });

/** The PDF as a byte string, where every byte is one character, so offsets can be checked. */
const latin1 = (bytes: Uint8Array) => Array.from(bytes, byte => String.fromCharCode(byte)).join('');

describe('buildPdf', () => {
  it('writes one page per picture with its paper size', () => {
    const pdf = latin1(buildPdf([page(595.28, 841.89), page(841.89, 595.28)]));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2');
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pdf).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(pdf).toContain('/Width 4 /Height 6 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 8');
  });

  it('points the cross-reference table at every object', () => {
    const pdf = latin1(buildPdf([page(100, 200)]));
    const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const entries = pdf.slice(xref).split('\n').slice(2, 8);
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });
});
