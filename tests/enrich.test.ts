import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';
import { enrichPlaces, reverseGeocodeWithRateLimit } from '../src/query/enrich.js';
import { whenWasIAtPlace } from '../src/query/place.js';

describe('enrichPlaces', () => {
  it('stores reverse geocoded place data and makes city queries work while keeping home label', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-enrich-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });

    const stats = await enrichPlaces(db, async (lat, lng) => {
      expect(lat).toBe(52.1);
      expect(lng).toBe(6.1);

      return {
        displayName: 'Amsterdam Centraal',
        road: 'Stationsplein',
        neighbourhood: null,
        suburb: 'Centrum',
        city: 'Amsterdam',
        state: 'Noord-Holland',
        country: 'Netherlands'
      };
    });

    expect(stats.enriched).toBe(1);
    const matches = whenWasIAtPlace(db, { placeIds: {} }, 'Amsterdam');

    expect(matches.items).toHaveLength(1);
    expect(matches.items[0].label).toBe('Home');
  });

  it('skips places already enriched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-enrich-skip-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });
    db.prepare(
      `
        insert into place_enrichment(
          place_id, lat, lng, display_name, road, neighbourhood, suburb, city, state, country
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run('place-home', 52.1, 6.1, 'Existing Name', null, null, null, 'Amsterdam', null, 'Netherlands');

    let calls = 0;
    const stats = await enrichPlaces(db, async () => {
      calls += 1;

      return {
        displayName: 'Should Not Happen',
        road: null,
        neighbourhood: null,
        suburb: null,
        city: 'Amsterdam',
        state: null,
        country: 'Netherlands'
      };
    });

    expect(calls).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it('enriches repeated place ids only once even when coordinates differ', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.prepare('insert into segments(id, type, start_time, end_time, raw_json) values (?, ?, ?, ?, ?)').run(
      1,
      'visit',
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:00:00+01:00',
      '{}'
    );
    db.prepare('insert into segments(id, type, start_time, end_time, raw_json) values (?, ?, ?, ?, ?)').run(
      2,
      'visit',
      '2024-01-02T09:00:00+01:00',
      '2024-01-02T10:00:00+01:00',
      '{}'
    );
    db.prepare('insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)').run(
      1,
      'same-place',
      'HOME',
      0.9,
      52.1,
      6.1
    );
    db.prepare('insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)').run(
      2,
      'same-place',
      'HOME',
      0.9,
      52.2,
      6.2
    );

    let calls = 0;
    const stats = await enrichPlaces(db, async () => {
      calls += 1;

      return {
        displayName: 'Single Place',
        road: null,
        neighbourhood: null,
        suburb: null,
        city: 'Amsterdam',
        state: null,
        country: 'Netherlands'
      };
    });

    expect(calls).toBe(1);
    expect(stats.enriched).toBe(1);
    expect((db.prepare('select count(*) as count from place_enrichment where place_id = ?').get('same-place') as { count: number }).count).toBe(1);
  });

  it('waits between sequential geocode requests', async () => {
    const sleeps: number[] = [];

    const lookup = reverseGeocodeWithRateLimit(
      async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          display_name: 'Amsterdam Centraal',
          address: { city: 'Amsterdam', country: 'Netherlands' }
        })
      }),
      ms => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      'timeline-mcp-test/1.0'
    );

    await lookup(52.1, 6.1, 'place-home');
    await lookup(52.2, 6.2, 'place-work');

    expect(Math.max(...sleeps)).toBeGreaterThanOrEqual(999);
  });

  it('retries after retry-after header', async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const lookup = reverseGeocodeWithRateLimit(
      async () => {
        calls += 1;

        if (calls === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '2' }),
            json: async () => ({})
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            display_name: 'Amsterdam Centraal',
            address: { city: 'Amsterdam', country: 'Netherlands' }
          })
        };
      },
      ms => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      'timeline-mcp-test/1.0'
    );

    const result = await lookup(52.1, 6.1, 'place-home');

    expect(calls).toBe(2);
    expect(sleeps).toContain(2000);
    expect(result.city).toBe('Amsterdam');
  });

  it('logs enrichment progress and retry waits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-enrich-log-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');
    const logFile = join(dir, 'timeline.log');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath }, createLogger('DEBUG', logFile));

    const lookup = reverseGeocodeWithRateLimit(
      async () => ({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
        json: async () => ({})
      }),
      () => Promise.resolve(),
      'timeline-mcp-test/1.0',
      createLogger('DEBUG', logFile)
    );

    await expect(enrichPlaces(db, lookup, createLogger('DEBUG', logFile))).rejects.toThrow('Reverse geocoding failed after retries');
    const logOutput = readFileSync(logFile, 'utf8');

    expect(logOutput).toContain('timeline import complete');
    expect(logOutput).toContain('enrichment started');
    expect(logOutput).toContain('reverse geocode retry scheduled');
  });
});
