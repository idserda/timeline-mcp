import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';
import { whereWasIAt, whereWasIBetween } from '../src/query/where.js';

describe('where queries', () => {
  it('prefers visit over overlapping activity and path points', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-where-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });

    const result = whereWasIAt(db, { placeIds: { 'place-home': 'Home' } }, '2024-01-01T09:30:00+01:00');

    expect(result?.label).toBe('Home');
    expect(result?.segmentType).toBe('visit');
  });

  it('returns ordered range summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-range-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });

    const result = whereWasIBetween(
      db,
      { placeIds: { 'place-home': 'Home' } },
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:30:00+01:00'
    );

    expect(result.items.map((item: { segmentType: string }) => item.segmentType)).toEqual(['visit', 'activity', 'timeline_path']);
  });

  it('uses manual alias before enriched place label for point-in-time query', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-where-enriched-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });
    db.prepare(
      `
        insert into place_enrichment(
          place_id, lat, lng, coord_key, display_name, road, neighbourhood, suburb, city, state, country
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run('place-home', 52.1, 6.1, '52.100,6.100', 'My House', null, null, null, 'Zwolle', null, 'Netherlands');

    const result = whereWasIAt(db, { placeIds: { 'place-home': 'My House' } }, '2024-01-01T09:30:00+01:00');

    expect(result?.label).toBe('My House');
  });

  it('prefers home semantic label over enriched address for point-in-time query', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-where-home-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });
    db.prepare(
      `
        insert into place_enrichment(
          place_id, lat, lng, coord_key, display_name, road, neighbourhood, suburb, city, state, country
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run('place-home', 52.1, 6.1, '52.100,6.100', '23 Main Street, Zwolle', null, null, null, 'Zwolle', null, 'Netherlands');

    const result = whereWasIAt(db, { placeIds: {} }, '2024-01-01T09:30:00+01:00');

    expect(result?.label).toBe('Home');
  });

  it('uses manual alias before enriched place label in range summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-range-enriched-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });
    db.prepare(
      `
        insert into place_enrichment(
          place_id, lat, lng, coord_key, display_name, road, neighbourhood, suburb, city, state, country
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run('place-home', 52.1, 6.1, '52.100,6.100', 'My House', null, null, null, 'Zwolle', null, 'Netherlands');

    const result = whereWasIBetween(
      db,
      { placeIds: { 'place-home': 'My House' } },
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:30:00+01:00'
    );

    expect(result.items[0].label).toBe('My House');
  });
});
