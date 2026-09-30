import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';
import { whenWasIAtPlace } from '../src/query/place.js';

describe('whenWasIAtPlace', () => {
  it('finds visits by alias and semantic type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-place-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });

    const matches = whenWasIAtPlace(db, { placeIds: { 'place-home': 'Home' } }, 'Home');

    expect(matches.items).toHaveLength(1);
    expect(matches.items[0].startTime).toBe('2024-01-01T09:00:00+01:00');
  });

  it('finds visits by enriched city and still shows home label for HOME semantic type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-place-city-'));
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
    ).run(
      'place-home',
      52.1,
      6.1,
      'Amsterdam Centraal',
      'Stationsplein',
      null,
      'Centrum',
      'Amsterdam',
      'Noord-Holland',
      'Netherlands'
    );

    const matches = whenWasIAtPlace(db, { placeIds: {} }, 'Amsterdam');

    expect(matches.items).toHaveLength(1);
    expect(matches.items[0].label).toBe('Home');
  });

  it('reuses nearby coordinate enrichment when place_id is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-place-coord-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(
      jsonPath,
      JSON.stringify({
        semanticSegments: [
          {
            startTime: '2024-01-03T09:00:00+01:00',
            endTime: '2024-01-03T10:00:00+01:00',
            visit: {
              topCandidate: {
                semanticType: 'UNKNOWN',
                probability: 0.9,
                placeLocation: { latLng: '52.1004°, 6.1004°' }
              }
            }
          }
        ]
      })
    );

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });
    db.prepare(
      `
        insert into place_enrichment(
          place_id, lat, lng, coord_key, display_name, road, neighbourhood, suburb, city, state, country
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(null, 52.1, 6.1, '52.100,6.100', 'Coord Label', 'Street', null, 'Centrum', 'Amsterdam', 'Noord-Holland', 'Netherlands');

    const matches = whenWasIAtPlace(db, { placeIds: {} }, 'Amsterdam');

    expect(matches.items).toHaveLength(1);
    expect(matches.items[0].label).toBe('Coord Label');
  });
});
