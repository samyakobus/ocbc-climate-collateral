/**
 * tests/unit/blank-image.test.ts - S43, #43 reopened.
 *
 * The guard that stops a live refresh replacing a good thumbnail with a blank
 * one. It exists because the pipeline shipped exactly that: the NASA GIBS MODIS
 * tile at z8/x201/y127 for 2026-09-08 is a uniformly black square, and it was
 * the image behind all 60 Singapore and 8 Johor Bahru properties including
 * `SG-EC-001`, the fixture the demo opens first.
 *
 * Every existing check passed it. It is a valid JPEG, it has the right magic
 * bytes, and at 1,665 bytes it is comfortably over any size floor. Nothing short
 * of decoding the pixels could have caught it, which is the point this file
 * pins down.
 *
 * The images here are BUILT, not fetched: a black one, a white one, a grey one
 * and a transparent one, drawn with `sharp` so the test needs no network and no
 * committed fixture. If `sharp` is absent the decode tests skip and the pure
 * decision tests still run, which is the same degradation the route makes.
 */

import { describe, expect, it } from 'vitest';

import {
  COVERAGE_FLOOR,
  LUMINANCE_CEILING,
  LUMINANCE_FLOOR,
  blankReason,
  isoDaysAgo,
  measureBlankness,
  withCaptureDate,
} from '@/lib/feeds/blank-image';

/** The slice of sharp's surface this file uses. */
type SharpCanvas = {
  jpeg(): { toBuffer(): Promise<Buffer> };
  png(): { toBuffer(): Promise<Buffer> };
};
type SharpFactory = (options: {
  create: {
    width: number;
    height: number;
    channels: number;
    background: { r: number; g: number; b: number; alpha: number };
  };
}) => SharpCanvas;

/** A solid JPEG of one colour, or null when sharp is not installed. */
async function solid(
  rgb: [number, number, number],
  alpha = 255,
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<Buffer | null> {
  try {
    /*
      The namespace object has no call signature, so `mod.default ?? mod`
      typechecks only once both sides are the factory type. Same shape as
      `lib/feeds/blank-image.ts`, and for the same reason: sharp is CommonJS
      reached through an ESM import.
    */
    const mod = (await import('sharp')) as unknown as { default?: SharpFactory };
    const sharp = mod.default ?? (mod as unknown as SharpFactory);

    const canvas = sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: alpha / 255 },
      },
    });

    /*
      An explicit branch rather than `canvas[format]()`. Indexing the sharp
      instance by a union of method names is not callable as far as TypeScript
      is concerned, and it slipped past a vitest run because vitest transpiles
      without typechecking. `tsc --noEmit` is what caught it.
    */
    return await (format === 'png' ? canvas.png() : canvas.jpeg()).toBuffer();
  } catch {
    return null;
  }
}

describe('the blank-image decision', () => {
  it('accepts imagery in the range real tiles actually occupy', () => {
    // Measured over all 200 pins: 48.7 to 242.9, coverage 99% or better.
    expect(blankReason({ luminance: 48.7, coverage: 0.99 })).toBeNull();
    expect(blankReason({ luminance: 128.7, coverage: 1 })).toBeNull();
    expect(blankReason({ luminance: 242.9, coverage: 1 })).toBeNull();
  });

  it('rejects the black tile that started this', () => {
    const reason = blankReason({ luminance: 0, coverage: 1 });
    expect(reason).toMatch(/blank black/);
  });

  it('rejects a white tile, which here means total cloud', () => {
    // Measured over the Pearl River Delta: 251.0 to 254.0, fully opaque.
    expect(blankReason({ luminance: 251, coverage: 1 })).toMatch(/blank white/);
    expect(blankReason({ luminance: 255, coverage: 1 })).toMatch(/blank white/);
  });

  it('rejects a tile that is mostly no data, before luminance is even considered', () => {
    /*
      An HLS tile outside the satellite swath is fully transparent. Composited
      onto white it becomes a pure white square, and onto black a pure black
      one, so the coverage check has to come first or the compositing choice
      decides which guard fires.
    */
    const reason = blankReason({ luminance: 255, coverage: 0 });
    expect(reason).toMatch(/no data/);
    expect(reason).not.toMatch(/blank white/);
  });

  it('treats an unmeasurable image as unmeasurable, not as fine', () => {
    expect(blankReason({ luminance: Number.NaN, coverage: 1 })).toMatch(/could not be measured/);
  });

  it('keeps its thresholds clear of both the blanks and the real range', () => {
    // A threshold sitting on a measured value is a coin toss on the next run.
    expect(LUMINANCE_FLOOR).toBeGreaterThan(0);
    expect(LUMINANCE_FLOOR).toBeLessThan(48.7);
    expect(LUMINANCE_CEILING).toBeGreaterThan(242.9);
    expect(LUMINANCE_CEILING).toBeLessThan(251);
    expect(COVERAGE_FLOOR).toBeGreaterThan(0);
    expect(COVERAGE_FLOOR).toBeLessThan(0.99);
  });
});

describe('measuring a real image', () => {
  /*
    The guard on the guard. Every test below opens with `if (!x) return;` so it
    degrades where `sharp` is absent, and a file full of those passes vacuously
    and silently. This one fails instead, so a machine that lost the decoder
    says so rather than reporting five green tests that measured nothing.
  */
  it('has a decoder here, so the tests below are not passing vacuously', async () => {
    const probe = await solid([128, 128, 128]);
    expect(
      probe,
      'sharp is not usable in this environment, so every decode test below is a no-op. ' +
        'The route degrades the same way, but the pipeline that builds the committed ' +
        'cache uses Pillow and always measures.',
    ).not.toBeNull();
  });

  it('measures a black JPEG below the floor', async () => {
    const black = await solid([0, 0, 0]);
    if (!black) return; // sharp absent; the route degrades the same way.

    // It is a valid JPEG of a plausible size, which is exactly why every other
    // guard in the pipeline let the real one through.
    expect(black[0]).toBe(0xff);
    expect(black[1]).toBe(0xd8);

    const measured = await measureBlankness(black);
    expect(measured).not.toBeNull();
    expect(measured!.luminance).toBeLessThan(LUMINANCE_FLOOR);
    expect(blankReason(measured!)).toMatch(/blank black/);
  });

  it('measures a white JPEG above the ceiling', async () => {
    const white = await solid([255, 255, 255]);
    if (!white) return;

    const measured = await measureBlankness(white);
    expect(measured!.luminance).toBeGreaterThan(LUMINANCE_CEILING);
    expect(blankReason(measured!)).toMatch(/blank white/);
  });

  it('accepts an ordinary mid-tone image', async () => {
    const grey = await solid([128, 128, 128]);
    if (!grey) return;

    const measured = await measureBlankness(grey);
    expect(measured!.coverage).toBeCloseTo(1, 2);
    expect(blankReason(measured!)).toBeNull();
  });

  it('sees a fully transparent PNG as no data', async () => {
    const empty = await solid([255, 255, 255], 0, 'png');
    if (!empty) return;

    const measured = await measureBlankness(empty);
    expect(measured!.coverage).toBeLessThan(COVERAGE_FLOOR);
    expect(blankReason(measured!)).toMatch(/no data/);
  });

  it('returns null rather than a verdict when the bytes are not an image', async () => {
    const measured = await measureBlankness(Buffer.from('<html>404</html>'));
    expect(measured, 'undecodable bytes must not produce a measurement').toBeNull();
  });
});

describe('stepping the capture date back', () => {
  const GIBS =
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/' +
    'default/2026-09-06/GoogleMapsCompatible_Level12/12/2033/3229.jpg';

  it('replaces the date segment and nothing else', () => {
    const moved = withCaptureDate(GIBS, '2026-08-30');
    expect(moved).toContain('/2026-08-30/');
    expect(moved).not.toContain('/2026-09-06/');
    // The tile coordinates must survive: they are also digits with slashes.
    expect(moved).toContain('/12/2033/3229.jpg');
  });

  it('returns null for a URL with no date to move', () => {
    expect(withCaptureDate('https://maps.googleapis.com/maps/api/staticmap?zoom=17', '2026-01-01'))
      .toBeNull();
  });

  it('counts back in whole UTC days', () => {
    expect(isoDaysAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(isoDaysAgo(1)).getTime()).toBeLessThan(new Date(isoDaysAgo(0)).getTime());
    const span = new Date(isoDaysAgo(0)).getTime() - new Date(isoDaysAgo(14)).getTime();
    expect(span).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
