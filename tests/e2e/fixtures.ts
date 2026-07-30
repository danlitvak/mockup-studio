import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder.
 *
 * Test media is generated rather than committed so the fixtures stay in step
 * with whatever dimensions a test needs, and the repo carries no binaries.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface PngOptions {
  width: number;
  height: number;
  /** Called per pixel; return [r, g, b] in 0..255. */
  paint?: (x: number, y: number, width: number, height: number) => [number, number, number];
}

/** A recognisable test image: colour bands plus a bright diagonal. */
const defaultPaint = (
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number, number] => {
  const band = Math.floor((y / height) * 4);
  const base: [number, number, number] =
    band === 0 ? [235, 87, 87] : band === 1 ? [242, 201, 76] : band === 2 ? [39, 174, 96] : [47, 128, 237];
  const onDiagonal = Math.abs(x / width - y / height) < 0.04;
  return onDiagonal ? [255, 255, 255] : base;
};

export function makePng({ width, height, paint = defaultPaint }: PngOptions): Buffer {
  const bytesPerPixel = 3;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y, width, height);
      const offset = rowStart + 1 + x * bytesPerPixel;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A portrait phone screenshot. */
export const phoneScreenshot = (): Buffer => makePng({ width: 540, height: 1170 });

/** A landscape capture, for testing `contain` against portrait devices. */
export const wideScreenshot = (): Buffer => makePng({ width: 1280, height: 720 });

/** Container sniffing, so export tests assert on real bytes not just size. */
export function detectContainer(bytes: Buffer): 'mp4' | 'webm' | 'png' | 'unknown' {
  if (bytes.length >= 8) {
    if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
    if (bytes.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
    if (bytes.readUInt32BE(0) === 0x89504e47) return 'png';
  }
  return 'unknown';
}
