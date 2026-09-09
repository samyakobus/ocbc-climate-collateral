/**
 * The per-property satellite thumbnail (#44; AC-11, AC-13, AC-14).
 *
 * What is asserted here is the offline promise, which is the whole reason the
 * panel is shaped the way it is:
 *
 *  - the rendered `<img>` is ALWAYS the committed same-origin cache path, so
 *    worker A's offline spec finds no external image on a case screen;
 *  - a null path is a designed placeholder, not a broken image;
 *  - a refresh that fails, in any of the ways it can, changes nothing on the
 *    page and says so;
 *  - a refresh that succeeds swaps the image in place with no navigation;
 *  - a path that is not same-origin is REFUSED even when the handler returns
 *    `ok`, because that value lands in an `<img src>`.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SatelliteThumb,
  isSameOriginThumb,
  type RefreshThumbResult,
} from '@/components/case/SatelliteThumb';

const CACHED = '/cache/thumbs/SG-EC-001-a1b2c3d4.jpg';
const NEWER = '/cache/thumbs/SG-EC-001-99887766.jpg';

/** The default action for the cases that never click: it must never be called. */
const NEVER = async (): Promise<RefreshThumbResult> => {
  throw new Error('the refresh action was called during render');
};

function renderThumb(
  path: string | null,
  refresh: (id: string) => Promise<RefreshThumbResult> = NEVER,
) {
  return render(
    <SatelliteThumb collateralId="SG-EC-001" path={path} refresh={refresh} />,
  );
}

describe('what renders is always the committed cache', () => {
  it('renders the cached path as a same-origin image', () => {
    renderThumb(CACHED);
    const image = screen.getByTestId('satellite-thumb-image');
    expect(image.getAttribute('src')).toBe(CACHED);
    expect(image.getAttribute('src')).not.toMatch(/^https?:/);
    expect(image).toHaveAttribute('alt', expect.stringContaining('SG-EC-001'));
  });

  it('shows a placeholder rather than a broken image when there is no path', () => {
    renderThumb(null);
    expect(screen.getByTestId('satellite-thumb-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('satellite-thumb-image')).toBeNull();
  });

  it('refuses a stored path that is not a same-origin cache path', () => {
    /* Defence in depth: the column should never hold this, and if it did the
       case screen would make an outbound request on a render path. */
    renderThumb('https://gibs.earthdata.nasa.gov/tile.jpg');
    expect(screen.getByTestId('satellite-thumb-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('satellite-thumb-image')).toBeNull();
  });
});

describe('isSameOriginThumb', () => {
  it('accepts a rooted path under the cache directory and nothing else', () => {
    expect(isSameOriginThumb(CACHED)).toBe(true);
    expect(isSameOriginThumb('/cache/thumbs/a.jpg')).toBe(true);

    expect(isSameOriginThumb('https://example.com/a.jpg')).toBe(false);
    expect(isSameOriginThumb('//example.com/a.jpg')).toBe(false);
    expect(isSameOriginThumb('/cache/tiles/a.jpg')).toBe(false);
    expect(isSameOriginThumb('/cache/thumbs/../../etc/passwd')).toBe(false);
    expect(isSameOriginThumb('cache/thumbs/a.jpg')).toBe(false);
    expect(isSameOriginThumb(null)).toBe(false);
    expect(isSameOriginThumb(undefined)).toBe(false);
  });
});

describe('the refresh is a click, and a failure changes nothing', () => {
  it('swaps to the new path in place when the refresh succeeds', async () => {
    const refresh = vi.fn(async () => ({
      ok: true,
      message: 'Imagery updated.',
      path: NEWER,
    }));
    renderThumb(CACHED, refresh);

    await userEvent.click(screen.getByTestId('refresh-thumb'));

    expect(refresh).toHaveBeenCalledWith('SG-EC-001');
    expect(await screen.findByTestId('refresh-thumb-status')).toHaveTextContent(
      'Imagery updated.',
    );
    expect(screen.getByTestId('satellite-thumb-image').getAttribute('src')).toBe(NEWER);
  });

  it('keeps the cached image and reports the message when the refresh fails', async () => {
    const refresh = vi.fn(async () => ({
      ok: false,
      message: 'Imagery refresh is not available on this build. Showing the cached image.',
    }));
    renderThumb(CACHED, refresh);

    await userEvent.click(screen.getByTestId('refresh-thumb'));

    expect(await screen.findByTestId('refresh-thumb-status')).toHaveTextContent(
      'not available',
    );
    expect(screen.getByTestId('satellite-thumb-image').getAttribute('src')).toBe(CACHED);
  });

  it('keeps the cached image when the refresh throws', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('network down');
    });
    renderThumb(CACHED, refresh);

    await userEvent.click(screen.getByTestId('refresh-thumb'));

    expect(await screen.findByTestId('refresh-thumb-status')).toHaveTextContent(
      'Refresh failed',
    );
    expect(screen.getByTestId('satellite-thumb-image').getAttribute('src')).toBe(CACHED);
  });

  it('refuses an external path even when the handler reports success', async () => {
    const refresh = vi.fn(async () => ({
      ok: true,
      message: 'Imagery updated.',
      path: 'https://gibs.earthdata.nasa.gov/newer.jpg',
    }));
    renderThumb(CACHED, refresh);

    await userEvent.click(screen.getByTestId('refresh-thumb'));
    await screen.findByTestId('refresh-thumb-status');

    expect(screen.getByTestId('satellite-thumb-image').getAttribute('src')).toBe(CACHED);
  });

  it('still offers a refresh when there is no cached image at all', async () => {
    const refresh = vi.fn(async () => ({
      ok: true,
      message: 'Imagery updated.',
      path: NEWER,
    }));
    renderThumb(null, refresh);

    expect(screen.getByTestId('satellite-thumb-placeholder')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('refresh-thumb'));

    expect(await screen.findByTestId('satellite-thumb-image')).toHaveAttribute('src', NEWER);
    expect(screen.queryByTestId('satellite-thumb-placeholder')).toBeNull();
  });
});
