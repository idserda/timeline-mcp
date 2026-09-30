import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { rebuildTimelineIndex } from '../src/import/importTimeline.js';
import { summarizeDay } from '../src/query/summarize.js';

describe('summarizeDay', () => {
  it('returns grouped stays and travel totals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-summary-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, readFileSync(new URL('../fixtures/timeline-sample.json', import.meta.url), 'utf8'));

    const db = new Database(dbPath);
    ensureSchema(db);
    rebuildTimelineIndex(db, { jsonPath, dbPath });

    const summary = summarizeDay(db, { placeIds: { 'place-home': 'Home' } }, '2024-01-01');

    expect(summary.visits.map((visit: { label: string }) => visit.label)).toEqual(['Home']);
    expect(summary.totalDistanceMeters).toBe(1000);
  });
});
