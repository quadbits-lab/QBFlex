import { QBError, type TransformOptions } from '@qb-flex/contracts';

const MAX_DIMENSION = 4096;
const MAX_PIXELS = 25_000_000;
const FITS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const;
const FORMATS = ['jpeg', 'png', 'webp'] as const;

type Fit = (typeof FITS)[number];
type Format = (typeof FORMATS)[number];

function integer(value: number | undefined, label: string) {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DIMENSION)
    throw new QBError('VALIDATION', `${label} must be an integer from 1 to ${MAX_DIMENSION}`);
  return value;
}

function sniff(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp';
  return 'application/octet-stream';
}

function mimeFor(format: Format) {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
}

function sourceFormat(format: string): Format | null {
  if (format === 'jpg' || format === 'jpeg') return 'jpeg';
  if (format === 'png' || format === 'webp') return format;
  return null;
}

function imageApi() {
  const api = (Bun as { Image?: typeof Bun.Image }).Image;
  if (typeof api !== 'function')
    throw new QBError('UNSUPPORTED', 'Image transforms require a certified image decoder', 501);
  return api;
}

function asImageError(error: unknown): never {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (code === 'ERR_IMAGE_TOO_MANY_PIXELS')
    throw new QBError('LIMIT_EXCEEDED', 'Image exceeds 25 million pixels', 413);
  if (error instanceof QBError) throw error;
  throw new QBError('VALIDATION', 'Image could not be decoded', 400);
}

/**
 * Bounded resize/re-encode. Identity options return the original bytes.
 * Bun.Image has no crop, so cover/outside scale to the covering box and keep
 * the extra pixels instead of cropping them away.
 */
export async function transformImage(
  bytes: Uint8Array,
  options: TransformOptions = {},
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!(bytes instanceof Uint8Array)) throw new QBError('VALIDATION', 'Image bytes are required');
  const width = integer(options.width, 'Width');
  const height = integer(options.height, 'Height');
  if (
    options.quality != null &&
    (!Number.isSafeInteger(options.quality) || options.quality < 1 || options.quality > 100)
  )
    throw new QBError('VALIDATION', 'Quality must be an integer from 1 to 100');
  if (options.format != null && !(FORMATS as readonly string[]).includes(options.format))
    throw new QBError('VALIDATION', 'Format must be jpeg, png, or webp');
  if (options.fit != null && !(FITS as readonly string[]).includes(options.fit))
    throw new QBError('VALIDATION', 'Fit must be cover, contain, fill, inside, or outside');
  const format = options.format;
  if (width == null && height == null && format == null && options.quality == null)
    return { bytes, mime: sniff(bytes) };
  const Image = imageApi();
  try {
    const meta = await new Image(bytes, { maxPixels: MAX_PIXELS }).metadata();
    const output = format ?? sourceFormat(meta.format);
    if (!output) throw new QBError('VALIDATION', 'Unsupported image format');
    const image = new Image(bytes, { maxPixels: MAX_PIXELS });
    if (width != null || height != null) applyResize(image, meta.width, meta.height, width, height, options.fit ?? 'fill');
    switch (output) {
      case 'jpeg':
        image.jpeg(options.quality != null ? { quality: options.quality } : {});
        break;
      case 'png':
        image.png();
        break;
      case 'webp':
        image.webp(options.quality != null ? { quality: options.quality } : {});
        break;
      default: {
        const unreachable: never = output;
        return unreachable;
      }
    }
    return { bytes: await image.bytes(), mime: mimeFor(output) };
  } catch (error) {
    asImageError(error);
  }
}

function applyResize(
  image: Bun.Image,
  sourceWidth: number,
  sourceHeight: number,
  width: number | undefined,
  height: number | undefined,
  fit: Fit,
) {
  if (sourceWidth < 1 || sourceHeight < 1)
    throw new QBError('VALIDATION', 'Image could not be decoded');
  if (width != null && height == null) {
    image.resize(width);
    return;
  }
  if (width == null && height != null) {
    const scaled = Math.max(1, Math.round((sourceWidth * height) / sourceHeight));
    assertPixels(scaled, height);
    image.resize(scaled, height, { fit: 'fill' });
    return;
  }
  const targetWidth = width!;
  const targetHeight = height!;
  switch (fit) {
    case 'fill':
      image.resize(targetWidth, targetHeight, { fit: 'fill' });
      return;
    case 'inside':
    case 'contain':
      image.resize(targetWidth, targetHeight, { fit: 'inside' });
      return;
    case 'cover':
    case 'outside': {
      const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
      const outWidth = Math.max(1, Math.round(sourceWidth * scale));
      const outHeight = Math.max(1, Math.round(sourceHeight * scale));
      assertPixels(outWidth, outHeight);
      image.resize(outWidth, outHeight, { fit: 'fill' });
      return;
    }
    default: {
      const unreachable: never = fit;
      throw new QBError('VALIDATION', `Unsupported fit ${unreachable}`);
    }
  }
}

function assertPixels(width: number, height: number) {
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS)
    throw new QBError('LIMIT_EXCEEDED', 'Image transform exceeds the pixel limit', 413);
}
