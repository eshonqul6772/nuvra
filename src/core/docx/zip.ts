/**
 * Minimal ZIP container support for Office documents, without dependencies: writing stores files uncompressed, which
 * every ZIP reader (Word included) accepts; reading also inflates deflated entries with the browser's
 * `DecompressionStream`.
 */

/** A file inside a ZIP archive. */
export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  /** File content. */
  data: Uint8Array;
}

const LOCAL_FILE_HEADER = 0x04_03_4b_50;
const CENTRAL_DIRECTORY_HEADER = 0x02_01_4b_50;
const END_OF_CENTRAL_DIRECTORY = 0x06_05_4b_50;
/** Version 2.0, the version needed for stored and deflated files. */
const ZIP_VERSION = 20;
/** General purpose flag telling readers that names are UTF-8. */
const UTF8_FLAG = 0x08_00;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
/** Longest trailing comment a ZIP file may have, which bounds the search for the end record. */
const MAX_COMMENT_LENGTH = 0xff_ff;
/** DOS date of 1 January 2026, 00:00; Office does not care about entry times. */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** CRC-32 lookup table (polynomial 0xEDB88320). */
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** CRC-32 checksum of the data. */
export const crc32 = (data: Uint8Array): number => {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
};

/** Packs files into an uncompressed ZIP archive. */
export const createZip = (entries: ZipEntry[]): Uint8Array => {
  const encoder = new TextEncoder();
  const records = entries.map(entry => ({ ...entry, nameBytes: encoder.encode(entry.name), crc: crc32(entry.data) }));
  const localSize = records.reduce(
    (sum, record) => sum + LOCAL_HEADER_SIZE + record.nameBytes.length + record.data.length,
    0
  );
  const centralSize = records.reduce((sum, record) => sum + CENTRAL_HEADER_SIZE + record.nameBytes.length, 0);
  const output = new Uint8Array(localSize + centralSize + END_RECORD_SIZE);
  const view = new DataView(output.buffer);
  let offset = 0;
  const offsets: number[] = [];

  for (const record of records) {
    offsets.push(offset);
    view.setUint32(offset, LOCAL_FILE_HEADER, true);
    view.setUint16(offset + 4, ZIP_VERSION, true);
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 8, METHOD_STORED, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, DOS_DATE, true);
    view.setUint32(offset + 14, record.crc, true);
    view.setUint32(offset + 18, record.data.length, true);
    view.setUint32(offset + 22, record.data.length, true);
    view.setUint16(offset + 26, record.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(record.nameBytes, offset + LOCAL_HEADER_SIZE);
    output.set(record.data, offset + LOCAL_HEADER_SIZE + record.nameBytes.length);
    offset += LOCAL_HEADER_SIZE + record.nameBytes.length + record.data.length;
  }

  const centralStart = offset;
  records.forEach((record, index) => {
    view.setUint32(offset, CENTRAL_DIRECTORY_HEADER, true);
    view.setUint16(offset + 4, ZIP_VERSION, true);
    view.setUint16(offset + 6, ZIP_VERSION, true);
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, METHOD_STORED, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, DOS_DATE, true);
    view.setUint32(offset + 16, record.crc, true);
    view.setUint32(offset + 20, record.data.length, true);
    view.setUint32(offset + 24, record.data.length, true);
    view.setUint16(offset + 28, record.nameBytes.length, true);
    view.setUint32(offset + 42, offsets[index] ?? 0, true);
    output.set(record.nameBytes, offset + CENTRAL_HEADER_SIZE);
    offset += CENTRAL_HEADER_SIZE + record.nameBytes.length;
  });

  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(offset + 8, records.length, true);
  view.setUint16(offset + 10, records.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  return output;
};

/** Inflates raw deflate data with the browser's streams API. */
const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * Reads every file of a ZIP archive. Stored and deflated entries are supported, which covers the files Office and
 * other editors write.
 *
 * @throws Error when the data is not a ZIP archive or uses an unsupported compression method.
 */
export const readZip = async (buffer: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  const lowest = Math.max(0, bytes.length - END_RECORD_SIZE - MAX_COMMENT_LENGTH);
  for (let index = bytes.length - END_RECORD_SIZE; index >= lowest; index -= 1) {
    if (view.getUint32(index, true) === END_OF_CENTRAL_DIRECTORY) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP archive');

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) throw new Error('Broken ZIP directory');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + CENTRAL_HEADER_SIZE, offset + CENTRAL_HEADER_SIZE + nameLength)
    );
    offset += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    if (method === METHOD_STORED) files.set(name, raw.slice());
    else if (method === METHOD_DEFLATED) files.set(name, await inflateRaw(raw));
    else throw new Error(`Unsupported ZIP compression method ${method}`);
  }
  return files;
};
