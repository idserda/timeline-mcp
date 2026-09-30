import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';

describe('rebuildTimelineIndex', () => {
  it('imports visits, activities, and path points into sqlite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-import-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(
      jsonPath,
      JSON.stringify({
        semanticSegments: [
          {
            startTime: '2024-01-01T09:00:00+01:00',
            endTime: '2024-01-01T10:00:00+01:00',
            visit: {
              topCandidate: {
                placeId: 'place-home',
                semanticType: 'HOME',
                probability: 0.99,
                placeLocation: { latLng: '52.1°, 6.1°' }
              }
            }
          },
          {
            startTime: '2024-01-01T10:00:00+01:00',
            endTime: '2024-01-01T10:30:00+01:00',
            activity: {
              start: { latLng: '52.1°, 6.1°' },
              end: { latLng: '52.2°, 6.2°' },
              distanceMeters: 1000,
              topCandidate: { type: 'WALKING', probability: 0.75 }
            }
          },
          {
            startTime: '2024-01-01T10:00:00+01:00',
            endTime: '2024-01-01T10:30:00+01:00',
            timelinePath: [
              { point: '52.15°, 6.15°', time: '2024-01-01T10:15:00+01:00' },
              { point: '52.2°, 6.2°', time: '2024-01-01T10:30:00+01:00' }
            ]
          }
        ]
      })
    );

    const db = new Database(dbPath);
    ensureSchema(db);

    const stats = rebuildTimelineIndex(db, { jsonPath, dbPath });

    expect(stats).toEqual({
      segmentCount: 3,
      visitCount: 1,
      activityCount: 1,
      pathPointCount: 2
    });
    expect(db.prepare('select count(*) as count from segments').get()).toEqual({ count: 3 });
    expect(db.prepare('select count(*) as count from visits').get()).toEqual({ count: 1 });
    expect(db.prepare('select count(*) as count from activities').get()).toEqual({ count: 1 });
    expect(db.prepare('select count(*) as count from path_points').get()).toEqual({ count: 2 });

    const metadataRows = db.prepare('select key, value from metadata order by key asc').all() as Array<{
      key: string;
      value: string;
    }>;
    const metadata = Object.fromEntries(metadataRows.map(row => [row.key, row.value]));

    expect(metadata.sourcePath).toBe(jsonPath);
    expect(metadata.sourceSize).toBeDefined();
    expect(metadata.sourceMtimeMs).toBeDefined();
    expect(metadata.schemaVersion).toBe('1');
  });
});

describe('ensureSchema', () => {
  it('upgrades existing place_enrichment table to add coord_key column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-schema-upgrade-'));
    const dbPath = join(dir, 'timeline.db');
    const db = new Database(dbPath);

    db.exec(`
      create table place_enrichment (
        place_id text primary key,
        lat real,
        lng real,
        display_name text,
        road text,
        neighbourhood text,
        suburb text,
        city text,
        state text,
        country text
      );
    `);

    ensureSchema(db);

    const columns = db.prepare("pragma table_info('place_enrichment')").all() as Array<{ name: string }>;

    expect(columns.map(column => column.name)).toContain('coord_key');
  });
});
