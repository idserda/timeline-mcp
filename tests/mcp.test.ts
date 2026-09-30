import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { getStatsResource, readDayResource } from '../src/mcp/resources.js';
import { callEnrichPlaces, callWhereWasIAt } from '../src/mcp/tools.js';

describe('mcp handlers', () => {
  it('returns stats resource payload with expected counts', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.prepare('insert into segments(type, start_time, end_time, raw_json) values (?, ?, ?, ?)').run(
      'visit',
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:00:00+01:00',
      '{}'
    );

    const stats = getStatsResource(db);

    expect(stats.segmentCount).toBe(1);
    expect(stats.firstTimestamp).toBe('2024-01-01T09:00:00+01:00');
  });

  it('returns where_was_i_at tool payload', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.prepare('insert into segments(id, type, start_time, end_time, raw_json) values (?, ?, ?, ?, ?)').run(
      1,
      'visit',
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:00:00+01:00',
      '{}'
    );
    db.prepare('insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)').run(
      1,
      'place-home',
      'HOME',
      0.99,
      52.1,
      6.1
    );

    const result = await callWhereWasIAt(db, { placeIds: { 'place-home': 'Home' } }, { timestamp: '2024-01-01T09:30:00+01:00' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Home');
  });

  it('returns day resource summary', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.prepare('insert into segments(id, type, start_time, end_time, raw_json) values (?, ?, ?, ?, ?)').run(
      1,
      'visit',
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:00:00+01:00',
      '{}'
    );
    db.prepare('insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)').run(
      1,
      'place-home',
      'HOME',
      0.99,
      52.1,
      6.1
    );

    const day = readDayResource(db, { placeIds: { 'place-home': 'Home' } }, '2024-01-01');

    expect(day.date).toBe('2024-01-01');
    expect(day.visits).toHaveLength(1);
  });

  it('returns enrich_places result payload', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.prepare('insert into segments(id, type, start_time, end_time, raw_json) values (?, ?, ?, ?, ?)').run(
      1,
      'visit',
      '2024-01-01T09:00:00+01:00',
      '2024-01-01T10:00:00+01:00',
      '{}'
    );
    db.prepare('insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)').run(
      1,
      'place-home',
      'HOME',
      0.99,
      52.1,
      6.1
    );

    const result = await callEnrichPlaces(
      db,
      async () => ({
        displayName: 'Amsterdam Centraal',
        road: 'Stationsplein',
        neighbourhood: null,
        suburb: 'Centrum',
        city: 'Amsterdam',
        state: 'Noord-Holland',
        country: 'Netherlands'
      })
    );

    expect(result.content[0].text).toContain('"enriched": 1');
  });
});
