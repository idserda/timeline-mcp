import type Database from 'better-sqlite3';
import type { AliasMap } from './aliases.js';
import type { PlaceDetails } from './placeNames.js';
import { howDidITravel } from './travel.js';
import { whereWasIBetween } from './where.js';

export type DaySummary = {
  date: string;
  visits: Array<{
    segmentId: number;
    segmentType: 'visit' | 'activity' | 'timeline_path';
    label: string;
    startTime: string;
    endTime: string;
  } & PlaceDetails>;
  movements: Array<{
    segmentId: number;
    segmentType: 'visit' | 'activity' | 'timeline_path';
    label: string;
    startTime: string;
    endTime: string;
  }>;
  totalDistanceMeters: number;
};

export function summarizeDay(db: Database.Database, aliases: AliasMap, date: string): DaySummary {
  const start = `${date}T00:00:00+00:00`;
  const end = `${date}T23:59:59.999+23:59`;
  const range = whereWasIBetween(db, aliases, start, end);
  const travel = howDidITravel(db, aliases, start, end);

  return {
    date,
    visits: range.items.filter((item: DaySummary['visits'][number]) => item.segmentType === 'visit'),
    movements: range.items.filter((item: DaySummary['movements'][number]) => item.segmentType !== 'visit'),
    totalDistanceMeters: travel.distanceMeters
  };
}
