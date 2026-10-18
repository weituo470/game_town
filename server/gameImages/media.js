import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const INPUT_BYTES = 5 * 1024 * 1024;
export const OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 16_000_000;
const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
export class GameImageMediaError extends Error {
  constructor(code = 'INVALID_IMAGE') { super(code); this.code = code; }
}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function decodeBase64(data, maxBytes) {
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(maxBytes / 3) * 4 || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data)) throw new GameImageMediaError('INVALID_IMAGE');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length || buffer.length > maxBytes || buffer.toString('base64') !== data) throw new GameImageMediaError('INVALID_IMAGE');
  return buffer;
}
export async function normalizeImage({ mime, data, buffer }, { output = false, inputHash, inputPixelHash } = {}) {
  const limit = output ? OUTPUT_BYTES : INPUT_BYTES;
  if (!Object.hasOwn(formats, mime)) throw new GameImageMediaError('UNSUPPORTED_IMAGE');
  const bytes = Buffer.isBuffer(buffer) ? buffer : decodeBase64(data, limit);
  if (!bytes.length || bytes.length > limit) throw new GameImageMediaError('IMAGE_TOO_LARGE');
  if (mime === 'image/png') {
    // libvips versions differ in APNG support. Reject its explicit animation
    // control chunk even when a decoder would silently read only frame one.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) break;
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new GameImageMediaError('ANIMATED_IMAGE_UNSUPPORTED');
      offset += length + 12;
    }
  }
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning', animated: true });
    const metadata = await image.metadata();
    if (metadata.format !== formats[mime] || (metadata.pages ?? 1) !== 1) throw new GameImageMediaError('INVALID_IMAGE');
    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 32 || metadata.height < 32 || metadata.width * metadata.height > MAX_PIXELS) throw new GameImageMediaError('IMAGE_DIMENSIONS');
    // Decode every pixel; rotate before discarding EXIF. Output never retains a
    // source profile, EXIF block, GPS coordinate, comment or embedded thumbnail.
    const { data: pixels, info } = await image.rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (output && (info.width !== 1024 || info.height !== 1024)) throw new GameImageMediaError('OUTPUT_DIMENSIONS');
    const pixelHash = digest(Buffer.concat([Buffer.from(`${info.width}x${info.height}:`), pixels]));
    const normalized = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: info.channels } }).png({ compressionLevel: 9 }).toBuffer();
    if (normalized.length > limit) throw new GameImageMediaError('IMAGE_TOO_LARGE');
    const sha256 = digest(normalized);
    if (output && (sha256 === inputHash || pixelHash === inputPixelHash)) throw new GameImageMediaError('OUTPUT_UNCHANGED');
    return { buffer: normalized, mime: 'image/png', width: info.width, height: info.height, sha256, pixelHash };
  } catch (error) { if (error instanceof GameImageMediaError) throw error; throw new GameImageMediaError('INVALID_IMAGE'); }
}
