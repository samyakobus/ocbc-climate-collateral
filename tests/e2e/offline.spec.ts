/**
 * tests/e2e/offline.spec.ts - S26. AC-11, AC-13, AC-14, AC-16.
 *
 * The automated half of the offline rehearsal. `tests/offline/checklist.md` is
 * the other half, the part no runner can observe, and it is run with the host
 * network interface physically disabled.
 *
 * HOW THIS IS MADE OFFLINE, and why the obvious way does not work.
 *
 * Playwright's `page.route` intercepts requests the BROWSER makes. The refresh
 * routes call out from the SERVER, inside a Next request handler, so a
 * browser-level block sails straight past them: written that way first, the
 * spec failed by succeeding, reaching NASA and reporting ok. What works is
 * pointing the three outbound hosts at a dead port, which makes the server
 * itself unable to reach anything:
 *
 *   FEED_EONET_BASE=http://127.0.0.1:9 FEED_GIBS_BASE=http://127.0.0.1:9 \
 *   THUMB_BASE=http://127.0.0.1:9 npx playwright test tests/e2e/offline.spec.ts
 *
 * Port 9 is the discard port and nothing listens on it, so every connection is
 * refused immediately rather than hanging until a timeout.
 *
 * Without those variables every test in this file SKIPS rather than passing.
 * A green run against the live feeds would assert nothing at all, and a skip
 * that names what is missing is worth more than a pass that means nothing.
 *
 * The hosts are read at request time through `lib/config/env.ts`, so passing
 * them to the Playwright process is enough and no rebuild is needed. That is
 * not free: Turbopack folds a literal `process.env.SOMETHING` to its BUILD-time
 * value, so this file only became honest once every runtime-configurable read
 * went through a variable key. Passing the same variables to `npm run build`
 * is harmless and is what the checklist tells an operator to do, because it
 * costs nothing and removes the question.
 *
 * WHAT IS ASSERTED, per the S26 clause:
 *
 *  1. Every screen renders its key elements: login, /cases in both segments, a
 *     case detail for each of the six pinned fixtures, /map, /portfolio,
 *     /rules, /ai.
 *  2. Both refresh buttons return the fallback message and write nothing.
 *  3. Cached satellite tiles and every image the app renders are served from
 *     this origin.
 *  4. NO REQUEST LEFT THE BOX. Every URL the browser asks for, on every screen,
 *     is recorded and asserted to be same-origin. This is the assertion that
 *     catches a font, a sprite, a glyph range or an analytics beacon that
 *     someone adds later, none of which any other test in the suite would see.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { login } from './support/map';

/**
 * The six pinned fixture rows (plan 4.3.2). Their case screens are walked
 * individually because they are the only rows in the database that are not
 * sampled, and they are the numbers the demo says out loud.
 */
const FIXTURES = [
  'SG-EC-001',
  'SG-EC-002',
  'SG-EC-003',
  'SG-KB-003',
  'SG-MS-002',
  'SG-MS-003',
] as const;

/** Schemes that never leave the machine, so they are not offsite requests. */
const LOCAL_SCHEMES = ['data:', 'blob:', 'about:', 'chrome-extension:', 'pmtiles:'];

type RequestLog = {
  /** Every URL the browser asked for since the listener was attached. */
  all: string[];
  /** Those that did not come from this app's own origin. */
  offsite(): string[];
};

/**
 * Record every request this page makes.
 *
 * `page.on('request')` fires for the document, every subresource, every fetch
 * and every worker script, which is exactly the surface AC-11 cares about. The
 * assertion is deliberately origin-based rather than a host allowlist: an
 * allowlist has to be maintained and a new entry looks innocent in a diff,
 * whereas "nothing but this origin" cannot be widened by accident.
 */
function recordRequests(page: Page, origin: string): RequestLog {
  const all: string[] = [];
  page.on('request', (request) => all.push(request.url()));

  return {
    all,
    offsite: () =>
      all.filter(
        (url) => !url.startsWith(origin) && !LOCAL_SCHEMES.some((s) => url.startsWith(s)),
      ),
  };
}

test.describe('S26: the application with the server genuinely offline', () => {
  /*
    There is no `test.skip` here, and its absence is the design.

    A conditional skip inside this file guarded it correctly and reported it
    badly: a skipped test still LISTS, so a green run reading "4 skipped" is one
    glance away from being read as coverage that does not exist, and the S28
    gate could not tell a deliberate skip from a broken one.

    `playwright.config.ts` now owns the condition. Without the three overridden
    hosts the `offline` project is not in the projects array at all, so this file
    is never collected and never counted. Inside this project, any skip is a real
    problem and `npm run verify:all` fails on one.

    One worker, and these specs read the same isolated database the rest of the
    suite reads. Nothing here writes: the refresh routes are asserted to change
    nothing, which is the whole point.
  */

  test('every screen renders its key elements and asks for nothing offsite', async ({
    page,
    baseURL,
  }) => {
    /* Twelve navigations in one test, deliberately: the request log has to span
       the whole walk for the offsite assertion to mean "on every screen". */
    test.slow();

    const origin = new URL(baseURL!).origin;
    const log = recordRequests(page, origin);

    // --- Login screen, before there is a session. --------------------------
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await login(page);

    // --- /cases, both segments. -------------------------------------------
    // The risk manager owns no segment, so the query parameter is honoured and
    // both officer views can be inspected from one session.
    for (const segment of ['personal', 'corporate'] as const) {
      await page.goto(`/cases?segment=${segment}`);
      await expect(page.getByTestId('cases-segment')).toHaveText(`Segment: ${segment}`);
      await expect(page.getByTestId('cases-summary')).toContainText('applications');
      const rows = page.locator('[data-testid^="case-row-"]');
      expect(await rows.count(), `${segment} has no rows`).toBeGreaterThan(0);
    }

    // --- A case detail for each of the six pinned fixtures. ----------------
    for (const id of FIXTURES) {
      const response = await page.goto(`/cases/${id}`);
      expect(response?.status(), `${id} status`).toBeLessThan(400);

      await expect(page.getByTestId('case-header'), `${id} header`).toBeVisible();
      await expect(page.getByTestId('case-id')).toHaveText(id);

      // The numbers, the reasoning and the sources: the three things a credit
      // officer would have to leave the room for if they did not render.
      await expect(page.getByTestId('haircut-breakdown'), `${id} breakdown`).toBeVisible();
      await expect(page.getByTestId('total-haircut'), `${id} total`).not.toBeEmpty();
      await expect(page.getByTestId('condition-list'), `${id} conditions`).toBeVisible();
      await expect(page.getByTestId('provenance-panel'), `${id} provenance`).toBeVisible();
      await expect(page.getByTestId('context-panel'), `${id} context`).toBeVisible();

      // Every provenance row names where its number came from, and none of
      // those sources is fetched at render: they are stored columns.
      const provenanceRows = page.locator('[data-testid^="provenance-row-"]');
      expect(await provenanceRows.count(), `${id} provenance rows`).toBeGreaterThan(0);
    }

    // --- /map. ------------------------------------------------------------
    // The pin layer is asserted by pin-click.spec.ts and slider.spec.ts. Here
    // the question is narrower and it is the offline one: the page renders, the
    // map finishes loading, and the basemap comes off this disk.
    //
    // Readiness comes from the `data-map-ready` attribute rather than from
    // `window.__portfolioMap`. That handle used to sit behind a NODE_ENV guard
    // and was dead-code-eliminated from the production bundle, so specs polled
    // an object that was not there and reported a rendering bug that did not
    // exist (#41). An attribute the component actually renders cannot vanish
    // that way.
    await page.goto('/map');
    await expect(page.getByTestId('map-heading')).toBeVisible();
    await expect(page.getByTestId('portfolio-map')).toBeVisible();
    await expect(page.getByTestId('portfolio-map')).toHaveAttribute(
      'data-map-ready',
      'true',
      { timeout: 60_000 },
    );
    await expect(page.getByTestId('map-legend')).toBeVisible();

    // --- /portfolio: the four headline figures. ---------------------------
    await page.goto('/portfolio');
    await expect(page.getByTestId('portfolio-heading')).toBeVisible();
    for (const tile of [
      'tile-share-amber',
      'tile-total-haircut',
      'tile-revalue-2030',
      'tile-collateral-value',
    ]) {
      await expect(page.getByTestId(tile), tile).not.toBeEmpty();
    }
    await expect(page.getByTestId('country-table')).toBeVisible();
    await expect(page.getByTestId('top-exposed')).toBeVisible();

    // --- /rules. ----------------------------------------------------------
    // Read only. Nothing is saved here: a save writes a new active rule set and
    // recomputes the book, which rule-edit.spec.ts owns and undoes.
    await page.goto('/rules');
    await expect(page.getByTestId('rules-heading')).toBeVisible();
    await expect(page.getByTestId('active-rule-set')).toContainText('Active rule set');
    await expect(page.getByTestId('return-period')).toBeVisible();

    // --- /ai. -------------------------------------------------------------
    await page.goto('/ai');
    await expect(page.getByTestId('ai-heading')).toBeVisible();
    await expect(page.getByTestId('satellite-strip')).toBeVisible();
    await expect(page.getByTestId('hotspot-map')).toBeVisible();
    await expect(page.getByTestId('news-list')).toBeVisible();

    // AC-16's floor: at least ten items, and the strip is not the empty state.
    await expect(page.getByTestId('strip-empty')).toHaveCount(0);
    await expect(page.getByTestId('news-empty')).toHaveCount(0);
    const newsItems = page.locator('[data-testid^="news-item-"]');
    expect(await newsItems.count(), 'news items').toBeGreaterThanOrEqual(10);

    // The hotspot detail panel, opened from the list rather than from the map
    // canvas, so this assertion does not depend on the pin layer having
    // rendered. Everything in it is a stored column.
    const firstHotspot = page.locator('[data-testid^="hotspot-item-"]').first();
    await expect(firstHotspot).toBeVisible();
    await firstHotspot.click();
    await expect(page.getByTestId('hotspot-popup')).toBeVisible();
    await expect(page.getByTestId('hotspot-name')).not.toBeEmpty();
    await expect(page.getByTestId('hotspot-exposure')).not.toBeEmpty();
    await expect(page.getByTestId('hotspot-share')).not.toBeEmpty();

    /*
      The score, offline.

      `scripts/e2e-server.ts` runs `computeReference` and does NOT run
      `prep:scores`, and there is no API key on this machine, so every hotspot
      is in the state a demo without a key will actually be in: no model score,
      a deterministic reference index, and a badge saying so. That is the state
      worth asserting here. `hotspot-popup.spec.ts` covers the scored path.

      A fallback badge is the CORRECT offline answer. What would be a failure is
      a blank panel, a spinner, or a model score appearing from somewhere.
    */
    await expect(page.getByTestId('score-gauge')).toBeVisible();
    await expect(page.getByTestId('score-badges')).toHaveAttribute('data-state', 'fallback');
    await expect(page.getByTestId('badge-fallback')).toBeVisible();

    /*
      The gauge shows the deterministic figure, and it is a real number.

      Scoped to the gauge rather than to the page: "Reference index" appears
      four times on this screen, and a bare text match is a strict-mode
      violation. The pair of assertions is also stronger than a lookup for the
      label alone, because the failure that matters here is the gauge showing a
      MODEL score when no model was ever called.
    */
    const gauge = page.getByTestId('score-gauge');
    await expect(page.getByTestId('score-value')).toContainText(/\d/);
    await expect(gauge).toContainText('Reference index');
    await expect(gauge, 'a model score appeared with no model').not.toContainText('Model score');

    /*
      Drivers and rationale are the model's own words, so with no model they are
      absent rather than empty-stringed. Asserting the ABSENCE is the point: a
      driver list rendered from nothing would mean something invented one.
    */
    await expect(page.getByTestId('hotspot-drivers')).toHaveCount(0);
    await expect(page.getByTestId('hotspot-rationale')).toHaveCount(0);

    /*
      The stored input list is deterministic and must be there: it is what the
      reference index was computed from, and AC-17 asks for it on screen.

      NINE stored fields, TWELVE display rows. `hazard_scores_by_type` is one
      JSONB key holding four fractions, and the panel flattens it into four
      labelled percentage rows, because `{"flood":0.1644,...}` in a cell hides
      that 0.1644 means 16.44%. Both numbers are asserted, so a future change to
      either the record or the flattening has to come through here.
    */
    await expect(page.getByTestId('hotspot-inputs-empty')).toHaveCount(0);
    const inputs = page.getByTestId('hotspot-inputs');
    await expect(inputs).toBeVisible();
    expect(await inputs.locator('dt').count(), 'input rows on screen').toBe(12);

    // The four hazard rows, each a percentage rather than a raw fraction.
    for (const [hazard, label] of [
      ['flood', 'Flood'],
      ['wind', 'Wind'],
      ['heat', 'Heat'],
      ['pm25', 'PM2.5'],
    ] as const) {
      const row = page.getByTestId(`hotspot-input-hazard_${hazard}`);
      await expect(row, `${label} row`).toHaveText(new RegExp(`^${label.replace('.', '\\.')}`));
    }
    await expect(inputs).toContainText('%');

    /*
      ADR-3's fence, visible on the panel. The reference index and its two
      denominators are withheld from the prompt, and each row says whether the
      model saw it. Exactly three rows must be marked withheld: if that number
      ever drifts, either the prompt grew or the marking broke, and both are
      things a director would be told wrongly.
    */
    expect(
      await inputs.locator('dt[data-sent-to-model="false"]').count(),
      'rows marked withheld from the model (ADR-3)',
    ).toBe(3);

    // --- The assertion the whole file exists for. -------------------------
    const offsite = log.offsite();
    expect(
      offsite,
      `${offsite.length} request(s) left this machine while the feeds were dead:\n` +
        offsite.join('\n'),
    ).toEqual([]);

    // A sanity check on the check: a listener that recorded nothing would make
    // the assertion above pass for the wrong reason.
    expect(log.all.length, 'the request listener recorded nothing').toBeGreaterThan(20);
  });

  test('both refresh buttons report the fallback and change nothing on screen', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const log = recordRequests(page, origin);

    await login(page);
    await page.goto('/ai');

    const newsCount = page.getByTestId('news-count');
    const before = {
      news: await newsCount.textContent(),
      items: await page.locator('[data-testid^="news-item-"]').count(),
      tiles: await page.locator('[data-testid^="tile-"]').count(),
    };

    // --- The tile refresh. ------------------------------------------------
    await page.getByTestId('refresh-tiles').click();
    const tileStatus = page.getByTestId('refresh-tiles-status');
    await expect(tileStatus).toBeVisible();
    await expect(tileStatus).toContainText(/cached imagery/i);

    // --- The news refresh. ------------------------------------------------
    await page.getByTestId('refresh-news').click();
    const newsStatus = page.getByTestId('refresh-news-status');
    await expect(newsStatus).toBeVisible();
    await expect(newsStatus).toContainText(/cached items/i);

    // Nothing disappeared. This is checklist step 9's clause, and it is the
    // reassuring half: a failure message beside intact content, not data loss.
    await expect(newsCount).toHaveText(before.news ?? '');
    expect(await page.locator('[data-testid^="news-item-"]').count()).toBe(before.items);
    expect(await page.locator('[data-testid^="tile-"]').count()).toBe(before.tiles);

    // --- And nothing was WRITTEN, which the screen cannot show. ------------
    // A route that half-succeeded would leave the second call reporting
    // something different. Both must be byte-identical.
    const news = await page.request.post('/api/refresh/news');
    const newsAgain = await page.request.post('/api/refresh/news');
    expect(news.status()).toBe(200);
    const newsBody = (await news.json()) as { ok: boolean; message: string };
    expect(newsBody.ok).toBe(false);
    expect((await newsAgain.json()).message).toBe(newsBody.message);

    const tiles = await page.request.post('/api/refresh/tiles');
    expect(tiles.status()).toBe(200);
    const tilesBody = (await tiles.json()) as { ok: boolean; refreshed?: number };
    expect(tilesBody.ok).toBe(false);
    expect(tilesBody.refreshed ?? 0).toBe(0);

    // A reload proves the page reads the same rows it read before the refresh.
    await page.reload();
    await expect(page.getByTestId('news-count')).toHaveText(before.news ?? '');

    const offsite = log.offsite();
    expect(offsite, `requests left this machine:\n${offsite.join('\n')}`).toEqual([]);
  });

  test('every cached tile and every rendered image is served from this origin', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await login(page);

    // --- The committed cache, file by file. -------------------------------
    const dir = resolve(process.cwd(), 'public/cache/tiles');
    const files = readdirSync(dir).filter((name) => name.endsWith('.jpg'));
    expect(files.length, 'no cached tiles are committed').toBeGreaterThanOrEqual(12);

    for (const name of files) {
      const response = await page.request.get(`/cache/tiles/${name}`);
      expect(response.status(), `/cache/tiles/${name}`).toBe(200);

      const body = await response.body();
      expect(body.byteLength, `${name} is too small to be imagery`).toBeGreaterThan(512);
      // JPEG magic: a 200 returning an HTML error page would otherwise pass.
      expect(body[0], `${name} is not a JPEG`).toBe(0xff);
      expect(body[1], `${name} is not a JPEG`).toBe(0xd8);
    }

    // --- What the strip actually points at. -------------------------------
    await page.goto('/ai');
    const sources = await page.locator('[data-testid^="tile-"] img').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLImageElement).getAttribute('src') ?? ''),
    );
    expect(sources.length, 'the strip rendered no images').toBeGreaterThanOrEqual(12);

    for (const src of sources) {
      expect(src, `${src} is not a cached local path`).toMatch(/^\/cache\/tiles\//);
      const response = await page.request.get(src);
      expect(response.status(), src).toBe(200);
    }

    // Every image the browser resolved really did come from this origin, which
    // catches a relative path that a base tag or a rewrite sent elsewhere.
    const resolved = await page
      .locator('img')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src));
    for (const url of resolved.filter(Boolean)) {
      expect(url, `${url} is not same-origin`).toContain(origin);
    }

    /*
      The per-property satellite thumbnail (S43). Every one of the 200 rows now
      carries a `satellite_thumb_path` pointing at a committed file under
      `/cache/thumbs/`, and the case screen renders that path and never the
      stored `satellite_thumb_url`. So there is no degraded view to rehearse
      here: nothing is fetched at render time, and these assertions are what
      keeps it that way. If a thumbnail ever starts resolving to a remote host,
      it fails here rather than on a projector.
    */
    for (const id of FIXTURES) {
      await page.goto(`/cases/${id}`);
      const caseImages = await page
        .locator('img')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src));
      for (const url of caseImages.filter(Boolean)) {
        expect(url, `${id}: ${url} is not same-origin`).toContain(origin);
      }
    }
  });

  test('the basemap is read from disk, at country and at city zoom', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const log = recordRequests(page, origin);

    await login(page);
    await page.goto('/map');
    await page.locator('canvas.maplibregl-canvas').waitFor();

    /*
      The pmtiles protocol turns a `pmtiles://` source into HTTP range requests
      against `/basemap/...`. Seeing those recorded is the positive evidence
      that the archive is being read over this origin rather than from a remote
      tile server, and it is what makes checklist step 6 meaningful.

      It is a poll rather than a single read because MapLibre fetches the
      archive header asynchronously after the canvas appears.
    */
    await expect
      .poll(() => log.all.filter((url) => url.includes('/basemap/')).length, {
        timeout: 30_000,
        message: 'the map never read the committed basemap archive',
      })
      .toBeGreaterThan(0);

    const offsite = log.offsite();
    expect(offsite, `the map reached offsite:\n${offsite.join('\n')}`).toEqual([]);
  });
});

/**
 * The two refresh ROUTES on their own, moved here from `refresh.spec.ts` so the
 * default project reports zero skipped tests.
 *
 * They were guarded there by a `test.skip` on the same three feed hosts, which
 * worked and read badly: a skipped test still lists, so every default run ended
 * "39 passed, 4 skipped" for ever, and a Skipped column that always reads 4 is
 * one people stop reading. In this project the condition is the project's own
 * existence, so there is nothing to skip and any skip is a real signal.
 *
 * These are narrower than the four tests above: those drive the UI, these post
 * to the routes directly. Both matter. A button that shows the right toast while
 * the route quietly wrote something would pass the UI test alone.
 */

type RefreshBody = {
  ok: boolean;
  message: string;
  refreshed?: number;
  total?: number;
};

test.describe('AC-11: the refresh routes with the server genuinely offline', () => {
  test('the news refresh toasts and leaves every item in place', async ({ page }) => {
    await login(page);

    const before = await page.request.post('/api/refresh/news');
    const beforeBody = (await before.json()) as RefreshBody;

    // A dead port is a connection refused, not a 500, and the body says what is
    // still on screen rather than only what failed.
    expect(before.status()).toBe(200);
    expect(beforeBody.ok).toBe(false);
    expect(beforeBody.message).toMatch(/cached items/i);

    // Nothing was written, so a second call reports identically.
    const again = await page.request.post('/api/refresh/news');
    expect(((await again.json()) as RefreshBody).message).toBe(beforeBody.message);
  });

  test('the tile refresh toasts and refreshes nothing', async ({ page }) => {
    await login(page);

    const response = await page.request.post('/api/refresh/tiles');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as RefreshBody;
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/cached imagery/i);
    expect(body.refreshed ?? 0).toBe(0);
  });

  test('the thumbnail refresh toasts and leaves the rendered image alone', async ({ page }) => {
    await login(page);

    // Named property, because this route refreshes one and not the book.
    const response = await page.request.post('/api/refresh/thumbs', {
      data: { collateral_id: FIXTURES[0] },
    });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as RefreshBody;
    expect(body.ok).toBe(false);
    expect(body.refreshed ?? 0).toBe(0);

    // The case screen still renders its committed file afterwards.
    await page.goto(`/cases/${FIXTURES[0]}`);
    const images = await page
      .locator('img')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src),
      );
    for (const url of images.filter(Boolean)) {
      expect(url, `${url} is not same-origin after a failed refresh`).toContain(
        new URL(page.url()).origin,
      );
    }
  });

  test('every screen still renders, which is the point of the whole rule', async ({ page }) => {
    await login(page);

    for (const path of ['/ai', '/portfolio', '/cases', '/map', '/rules']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} status`).toBeLessThan(400);
    }
  });
});
