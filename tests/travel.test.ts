import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';
import { howDidITravel } from '../src/query/travel.js';

describe('howDidITravel', () => {
  it('returns activity segments and sampled path points in range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-travel-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });

    const travel = howDidITravel(db, { placeIds: {} }, '2024-01-01T10:00:00+01:00', '2024-01-01T10:30:00+01:00');

    expect(travel.distanceMeters).toBe(1000);
    expect(travel.pathPoints).toHaveLength(2);
  });
});
