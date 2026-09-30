import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';
import { PlaceDetailsRateLimitError, lookupPlaceNameWithGoogle, resolvePlaceNames, type PlaceName } from '../src/query/placeNames.js';
import { whenWasIAtPlace } from '../src/query/place.js';
import { whereWasIAt } from '../src/query/where.js';

function placeName(overrides: Partial<PlaceName> = {}): PlaceName {
  return {
    name: 'Albert Heijn',
    formattedAddress: 'Stationsplein 1, 1012 AB Amsterdam',
    primaryType: 'supermarket',
    category: 'Supermarket',
    types: ['supermarket', 'grocery_store', 'food', 'store'],
    city: 'Amsterdam',
    postalCode: '1012 AB',
    country: 'Netherlands',
    googleMapsUri: 'https://maps.google.com/?cid=123',
    businessStatus: 'OPERATIONAL',
    ...overrides
  };
}

function buildDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'timeline-place-names-'));
  const jsonPath = join(dir, 'timeline.json');
  const dbPath = join(dir, 'timeline.db');

  writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

  const db = new Database(dbPath);
  ensureSchema(db);
  rebuildTimelineIndex(db, { jsonPath, dbPath });

  return db;
}

describe('resolvePlaceNames', () => {
  it('stores google place names and makes them searchable', async () => {
    const db = buildDb();
    const looked: string[] = [];

    const stats = await resolvePlaceNames(db, async placeId => {
      looked.push(placeId);
      return placeName();
    });

    expect(looked).toEqual(['place-home']);
    expect(stats).toEqual({ resolved: 1, notFound: 0 });

    const matches = whenWasIAtPlace(db, { placeIds: {} }, 'Albert Heijn');

    expect(matches.items).toHaveLength(1);
    expect(matches.items[0].label).toBe('Home');
  });

  it('uses place name as label when no alias or semantic label applies', async () => {
    const db = buildDb();
    db.prepare("update visits set semantic_type = 'UNKNOWN'").run();

    await resolvePlaceNames(db, async () => placeName());

    expect(whenWasIAtPlace(db, { placeIds: {} }, 'Albert Heijn').items[0].label).toBe('Albert Heijn');
  });

  it('matches visits by category and google type', async () => {
    const db = buildDb();
    await resolvePlaceNames(db, async () => placeName());

    expect(whenWasIAtPlace(db, { placeIds: {} }, 'supermarket').items).toHaveLength(1);
    expect(whenWasIAtPlace(db, { placeIds: {} }, 'Grocery store').items).toHaveLength(1);
    expect(whenWasIAtPlace(db, { placeIds: {} }, '1012 AB').items).toHaveLength(1);
    expect(whenWasIAtPlace(db, { placeIds: {} }, 'restaurant').items).toHaveLength(0);
  });

  it('adds category, maps link and closure status to visit results', async () => {
    const db = buildDb();
    await resolvePlaceNames(db, async () => placeName({ businessStatus: 'CLOSED_PERMANENTLY' }));

    const result = whereWasIAt(db, { placeIds: {} }, '2024-01-01T09:30:00+01:00');

    expect(result).toMatchObject({
      category: 'Supermarket',
      googleMapsUri: 'https://maps.google.com/?cid=123',
      businessStatus: 'CLOSED_PERMANENTLY'
    });
  });

  it('omits business status for operational places', async () => {
    const db = buildDb();
    await resolvePlaceNames(db, async () => placeName());

    expect(whereWasIAt(db, { placeIds: {} }, '2024-01-01T09:30:00+01:00')).not.toHaveProperty('businessStatus');
  });

  it('refetches rows cached before detail fields existed', async () => {
    const db = buildDb();
    db.prepare('insert into place_names(place_id, name) values (?, ?)').run('place-home', 'Old Name');

    const stats = await resolvePlaceNames(db, async () => placeName());

    expect(stats.resolved).toBe(1);
    expect(db.prepare('select name, category from place_names where place_id = ?').get('place-home')).toEqual({
      name: 'Albert Heijn',
      category: 'Supermarket'
    });
  });

  it('stops cleanly when rate limited and resumes on the next run', async () => {
    const db = buildDb();

    const stopped = await resolvePlaceNames(db, async () => {
      throw new PlaceDetailsRateLimitError();
    });

    expect(stopped).toEqual({ resolved: 0, notFound: 0, remaining: 1 });
    expect(await resolvePlaceNames(db, async () => placeName())).toEqual({ resolved: 1, notFound: 0 });
  });

  it('caches not found place ids and skips them on the next run', async () => {
    const db = buildDb();
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return null;
    };

    expect(await resolvePlaceNames(db, lookup)).toEqual({ resolved: 0, notFound: 1 });
    await resolvePlaceNames(db, lookup);

    expect(calls).toBe(1);
  });
});

describe('lookupPlaceNameWithGoogle', () => {
  it('parses place details', async () => {
    const lookup = lookupPlaceNameWithGoogle(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          displayName: { text: 'Albert Heijn' },
          formattedAddress: 'Stationsplein 1, 1012 AB Amsterdam',
          primaryType: 'supermarket',
          primaryTypeDisplayName: { text: 'Supermarket' },
          types: ['supermarket', 'grocery_store', 'food', 'store'],
          addressComponents: [
            { longText: 'Amsterdam', types: ['locality', 'political'] },
            { longText: 'Netherlands', types: ['country', 'political'] },
            { longText: '1012 AB', types: ['postal_code'] }
          ],
          googleMapsUri: 'https://maps.google.com/?cid=123',
          businessStatus: 'OPERATIONAL'
        })
      }),
      () => Promise.resolve()
    );

    expect(await lookup('ChIJN1t_tDeuEmsRUsoyG83frY4')).toEqual(placeName());
  });

  it('returns null for unknown place ids and retries on 429', async () => {
    const statuses = [429, 404];
    const sleeps: number[] = [];
    const lookup = lookupPlaceNameWithGoogle(
      async () => ({ ok: false, status: statuses.shift() ?? 500, json: async () => ({}) }),
      ms => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      { requestsPerMinute: 0 }
    );

    expect(await lookup('stale-id')).toBeNull();
    expect(sleeps).toEqual([2000]);
  });

  it('honours retry-after and backs off exponentially', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const lookup = lookupPlaceNameWithGoogle(
      async () => {
        calls += 1;
        return { ok: false, status: 429, headers: new Headers(calls === 1 ? { 'retry-after': '7' } : {}), json: async () => ({}) };
      },
      ms => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      { requestsPerMinute: 0, maxAttempts: 4 }
    );

    await expect(lookup('x')).rejects.toBeInstanceOf(PlaceDetailsRateLimitError);
    expect(calls).toBe(4);
    expect(sleeps).toEqual([7000, 4000, 8000]);
  });

  it('spaces requests according to requests per minute', async () => {
    const sleeps: number[] = [];
    const lookup = lookupPlaceNameWithGoogle(
      async () => ({ ok: true, status: 200, json: async () => ({}) }),
      ms => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      { requestsPerMinute: 30 }
    );

    await lookup('a');
    await lookup('b');

    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(1900);
    expect(sleeps[0]).toBeLessThanOrEqual(2000);
  });

  it('throws on other errors', async () => {
    const lookup = lookupPlaceNameWithGoogle(async () => ({ ok: false, status: 403, json: async () => ({}) }), () => Promise.resolve());

    await expect(lookup('x')).rejects.toThrow('Place details lookup failed: 403');
  });
});
