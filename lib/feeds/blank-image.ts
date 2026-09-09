/**
 * Is this image blank? (S43)
 *
 * Split out of `app/api/refresh/thumbs/route.ts` so it can be tested without a
 * database, a session or a network, and so the thresholds have one home on the
 * TypeScript side. The Python pipeline applies the identical three checks in
 * `prep/fetch_thumbs.py`; the numbers are repeated there rather than shared,
 * because a constant crossing a language boundary at build time is a worse
 * coupling than two documented copies with the same measurements beside them.
 *
 * WHY THREE CHECKS. A blank square on a case screen is a blank square whichever
 * way it got there, and the first version of the pipeline caught none of the
 * three ways. Measured over all 200 pins on 2026-09-09:
 *
 *   failure       reads as                        found at
 *   ------------  ------------------------------  ---------------------------
 *   blank black   mean luminance 0.0              MODIS z8/x201/y127, the tile
 *                                                 shared by 68 pins including
 *                                                 the fixture SG-EC-001
 *   blank white   mean luminance 251-255, opaque  total cloud over the Pearl
 *                                                 River Delta
 *   no data       0% opaque, white once composited HLS tiles outside the
 *                                                 satellite swath, north Jakarta
 *
 * Real imagery measured 48.7 to 242.9 at 99% coverage or better, so every
 * threshold below sits in a wide gap rather than on a boundary.
 */

/** Below this an image is blank black. */
export const LUMINANCE_FLOOR = 12;

/** Above this an image is blank white, which in this region means total cloud. */
export const LUMINANCE_CEILING = 245;

/** Below this fraction of opaque pixels the tile is mostly no-data. */
export const COVERAGE_FLOOR = 0.9;

/** How far back to look for a scene that is not blank. */
export const LOOKBACK_DAYS = 14;

export type Blankness = {
  /** Mean luminance 0-255, after compositing onto white. */
  luminance: number;
  /** Fraction of pixels with any opacity at all, 0-1. */
  coverage: number;
};

/**
 * None when the image is usable, else a sentence saying why it is not.
 *
 * Pure, so the decision is testable without decoding anything.
 */
export function blankReason(m: Blankness): string | null {
  if (!Number.isFinite(m.luminance) || !Number.isFinite(m.coverage)) {
    return 'the image could not be measured';
  }
  if (m.coverage < COVERAGE_FLOOR) {
    return `no data over ${Math.round((1 - m.coverage) * 100)}% of it`;
  }
  if (m.luminance < LUMINANCE_FLOOR) {
    return `blank black (luminance ${m.luminance.toFixed(1)})`;
  }
  if (m.luminance > LUMINANCE_CEILING) {
    return `blank white (luminance ${m.luminance.toFixed(1)}), probably total cloud`;
  }
  return null;
}

type SharpImage = {
  ensureAlpha(): SharpImage;
  raw(): SharpImage;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number; channels: number };
  }>;
};
type SharpFactory = (input: Buffer) => SharpImage;

/**
 * Decode an image and measure it, or return null when no decoder is available.
 *
 * `sharp` ships as an OPTIONAL dependency of Next, so it is present in this
 * install and is not guaranteed in every one. Declaring a hard dependency on it
 * would risk `npm ci` failing on a platform with no prebuilt binary, which is a
 * worse trade for a clean-clone story than degrading here.
 *
 * NULL means "not measured", never "fine". The caller must treat it as an
 * unknown and keep its other guards, rather than reading it as a pass.
 */
export async function measureBlankness(bytes: Buffer): Promise<Blankness | null> {
  let sharp: SharpFactory;
  try {
    const mod = (await import('sharp')) as unknown as { default?: SharpFactory };
    sharp = mod.default ?? (mod as unknown as SharpFactory);
  } catch {
    return null;
  }

  try {
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = info.width * info.height;
    if (pixels === 0) return null;

    let luminance = 0;
    let opaque = 0;

    for (let i = 0; i < data.length; i += info.channels) {
      // Rec. 601 luma, the weighting Pillow's "L" conversion uses, so the two
      // pipelines measure the same image the same way.
      luminance += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (data[i + info.channels - 1] > 0) opaque += 1;
    }

    return { luminance: luminance / pixels, coverage: opaque / pixels };
  } catch {
    // A payload sharp cannot decode is not a blank image, it is a broken one,
    // and the caller's JPEG-magic check is what reports that.
    return null;
  }
}

/** Replace the ISO date segment of a stored GIBS WMTS URL, or null if it has none. */
export function withCaptureDate(url: string, iso: string): string | null {
  const match = url.match(/\/(\d{4}-\d{2}-\d{2})\//);
  return match ? url.replace(match[0], `/${iso}/`) : null;
}

/** An ISO date `days` before today, in UTC. */
export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
