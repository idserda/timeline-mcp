import type Database from 'better-sqlite3';
import type { AliasMap } from './aliases.js';

export type TravelResult = {
  start: string;
  end: string;
  distanceMeters: number;
  segments: Array<{
    id: number;
    start_time: string;
    end_time: string;
    start_lat: number | null;
    start_lng: number | null;
    end_lat: number | null;
    end_lng: number | null;
    distance_meters: number | null;
    activity_type: string | null;
    probability: number | null;
  }>;
  pathPoints: Array<{
    segment_id: number;
    sequence_index: number;
    point_time: string;
    lat: number | null;
    lng: number | null;
  }>;
  notes: string[];
};

export function howDidITravel(
  db: Database.Database,
  _aliases: AliasMap,
  start: string,
  end: string
): TravelResult {
  const segments = db
    .prepare(
      `
        select s.id, s.start_time, s.end_time, a.start_lat, a.start_lng, a.end_lat, a.end_lng, a.distance_meters, a.activity_type, a.probability
        from segments s
        join activities a on a.segment_id = s.id
        where s.end_time >= ? and s.start_time <= ?
        order by s.start_time asc
      `
    )
    .all(start, end) as TravelResult['segments'];

  const pathPoints = db
    .prepare(
      `
        select p.segment_id, p.sequence_index, p.point_time, p.lat, p.lng
        from path_points p
        where p.point_time >= ? and p.point_time <= ?
        order by p.point_time asc, p.sequence_index asc
      `
    )
    .all(start, end) as TravelResult['pathPoints'];

  return {
    start,
    end,
    distanceMeters: segments.reduce((sum, row) => sum + (row.distance_meters ?? 0), 0),
    segments,
    pathPoints,
    notes: []
  };
}
