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

/**
 * A capture with a centred square drawn on it, for proving the media is not
 * distorted once it has been through the renderer.
 *
 * "Does the media fill the screen" cannot catch stretching: media drawn with
 * `cover` fills the screen whether or not its aspect survived the trip. A shape
 * that is known to be square at the source can — if it comes back out square,
 * the aspect ratio was preserved end to end.
 *
 * The marker is magenta on purpose. The device bodies, the traffic lights on
 * the browser frame and the gradient backdrop are all either desaturated or
 * red/yellow/green, and antialiased edges of the red traffic light otherwise
 * land close enough to a red marker to widen its measured bounding box.
 */
export const MARKER_RGB: [number, number, number] = [240, 20, 240];

export function squareMarkerScreenshot(width = 1280, height = 720, marker = 300): Buffer {
  const halfMarker = marker / 2;
  return makePng({
    width,
    height,
    paint: (x, y) =>
      Math.abs(x - width / 2) < halfMarker && Math.abs(y - height / 2) < halfMarker
        ? MARKER_RGB
        : [18, 18, 22],
  });
}

/** Container sniffing, so export tests assert on real bytes not just size. */
export function detectContainer(bytes: Buffer): 'mp4' | 'webm' | 'png' | 'unknown' {
  if (bytes.length >= 8) {
    if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
    if (bytes.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
    if (bytes.readUInt32BE(0) === 0x89504e47) return 'png';
  }
  return 'unknown';
}

/**
 * Enough of an MP4 box walker to describe the video track.
 *
 * Decoding an export proves it is playable; this proves what it actually is.
 * A file can decode fine and still be wrong — the wrong codec in the box, or a
 * frame count that quietly disagrees with the requested fps and duration.
 * Written by hand for the same reason the PNG encoder is: no test binaries and
 * no extra dependency.
 */
export interface Mp4VideoTrack {
  /** Sample entry type — `avc1` for H.264. */
  codec: string;
  /** H.264 profile, when the sample entry carries an `avcC` box. */
  profile: string | null;
  /** H.264 level, e.g. 4 for level 4.0. */
  level: number | null;
  width: number;
  height: number;
  /** Encoded frames actually written to the file. */
  samples: number;
  /** Track duration in seconds, from the media header. */
  duration: number;
}

interface Box {
  type: string;
  /** First byte of the box's payload, past its header. */
  content: number;
  /** One past the box's last byte. */
  end: number;
}

function* boxes(bytes: Buffer, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    let header = 8;

    if (size === 1) {
      // 64-bit size, stored immediately after the type.
      if (offset + 16 > end) return;
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset; // runs to the end of the file
    }

    if (size < header || offset + size > end) return;
    yield { type, content: offset + header, end: offset + size };
    offset += size;
  }
}

const findBox = (bytes: Buffer, start: number, end: number, type: string): Box | null => {
  for (const box of boxes(bytes, start, end)) {
    if (box.type === type) return box;
  }
  return null;
};

const firstBox = (bytes: Buffer, start: number, end: number): Box | null => {
  for (const box of boxes(bytes, start, end)) return box;
  return null;
};

const AVC_PROFILES: Record<number, string> = { 0x42: 'Baseline', 0x4d: 'Main', 0x64: 'High' };

/** Describe the first video track in an MP4, or `null` if there is not one. */
export function mp4VideoTrack(bytes: Buffer): Mp4VideoTrack | null {
  const moov = findBox(bytes, 0, bytes.length, 'moov');
  if (!moov) return null;

  for (const trak of boxes(bytes, moov.content, moov.end)) {
    if (trak.type !== 'trak') continue;

    const mdia = findBox(bytes, trak.content, trak.end, 'mdia');
    if (!mdia) continue;
    const mdhd = findBox(bytes, mdia.content, mdia.end, 'mdhd');
    const minf = findBox(bytes, mdia.content, mdia.end, 'minf');
    if (!mdhd || !minf) continue;
    const stbl = findBox(bytes, minf.content, minf.end, 'stbl');
    if (!stbl) continue;
    const stsd = findBox(bytes, stbl.content, stbl.end, 'stsd');
    if (!stsd) continue;

    // stsd is a full box: 4 bytes of version/flags, 4 of entry count, then entries.
    const entry = firstBox(bytes, stsd.content + 8, stsd.end);
    if (!entry) continue;

    // A visual sample entry puts width and height 24 bytes into its payload;
    // an audio one does not, so a zero here means this is the wrong track.
    const width = bytes.readUInt16BE(entry.content + 24);
    const height = bytes.readUInt16BE(entry.content + 26);
    if (width === 0 || height === 0) continue;

    // Child boxes of a visual sample entry start after its fixed 78-byte body.
    const avcC = findBox(bytes, entry.content + 78, entry.end, 'avcC');
    const profileByte = avcC ? bytes[avcC.content + 1]! : null;

    const version = bytes[mdhd.content]!;
    const timescale = bytes.readUInt32BE(mdhd.content + (version === 1 ? 20 : 12));
    const rawDuration =
      version === 1
        ? Number(bytes.readBigUInt64BE(mdhd.content + 24))
        : bytes.readUInt32BE(mdhd.content + 16);

    const stsz = findBox(bytes, stbl.content, stbl.end, 'stsz');

    return {
      codec: entry.type,
      profile:
        profileByte === null
          ? null
          : (AVC_PROFILES[profileByte] ?? `0x${profileByte.toString(16)}`),
      level: avcC ? bytes[avcC.content + 3]! / 10 : null,
      width,
      height,
      samples: stsz ? bytes.readUInt32BE(stsz.content + 8) : 0,
      duration: timescale > 0 ? rawDuration / timescale : 0,
    };
  }

  return null;
}
