import type Database from 'better-sqlite3';
import type { AliasMap } from '../query/aliases.js';
import { summarizeDay } from '../query/summarize.js';

export function getStatsResource(db: Database.Database): {
  segmentCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  visitCount: number;
  activityCount: number;
  pathPointCount: number;
} {
  const segmentCount = (db.prepare('select count(*) as count from segments').get() as { count: number }).count;
  const first = db.prepare('select start_time from segments order by start_time asc limit 1').get() as
    | { start_time: string }
    | undefined;
  const last = db.prepare('select end_time from segments order by end_time desc limit 1').get() as
    | { end_time: string }
    | undefined;

  return {
    segmentCount,
    firstTimestamp: first?.start_time ?? null,
    lastTimestamp: last?.end_time ?? null,
    visitCount: (db.prepare('select count(*) as count from visits').get() as { count: number }).count,
    activityCount: (db.prepare('select count(*) as count from activities').get() as { count: number }).count,
    pathPointCount: (db.prepare('select count(*) as count from path_points').get() as { count: number }).count
  };
}

export function readDayResource(db: Database.Database, aliases: AliasMap, date: string) {
  return summarizeDay(db, aliases, date);
}

export function readSegmentResource(db: Database.Database, id: number) {
  const segment = db.prepare('select * from segments where id = ?').get(id) as Record<string, unknown> | undefined;
  return segment ?? null;
}
