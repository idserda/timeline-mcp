import type Database from 'better-sqlite3';
import { resolveLabel, type AliasMap } from './aliases.js';
import { findPlaceDetails, type PlaceDetails } from './placeNames.js';

export type WhereAtResult = {
  segmentId: number;
  segmentType: 'visit' | 'activity' | 'timeline_path';
  label: string;
  startTime: string;
  endTime: string;
  coordinates: { lat: number; lng: number } | null;
  confidence: number | null;
} & PlaceDetails;

export type RangeResult = {
  start: string;
  end: string;
  items: Array<{
    segmentId: number;
    segmentType: 'visit' | 'activity' | 'timeline_path';
    label: string;
    startTime: string;
    endTime: string;
  } & PlaceDetails>;
};

export function whereWasIAt(
  db: Database.Database,
  aliases: AliasMap,
  timestamp: string
): WhereAtResult | null {
  const visit = db
    .prepare(
      `
        select s.id, s.start_time, s.end_time, v.place_id, v.semantic_type, v.lat, v.lng, v.probability
        from segments s
        join visits v on v.segment_id = s.id
        where s.start_time <= ? and s.end_time >= ?
        order by s.start_time desc
        limit 1
      `
    )
    .get(timestamp, timestamp) as
    | {
        id: number;
        start_time: string;
        end_time: string;
        place_id: string | null;
        semantic_type: string | null;
        lat: number | null;
        lng: number | null;
        probability: number | null;
      }
    | undefined;

  if (visit) {
    return {
      segmentId: visit.id,
      segmentType: 'visit',
      label: resolveLabel(aliases, visit.place_id, visit.semantic_type, visit.lat, visit.lng, db),
      startTime: visit.start_time,
      endTime: visit.end_time,
      coordinates: visit.lat !== null && visit.lng !== null ? { lat: visit.lat, lng: visit.lng } : null,
      confidence: visit.probability ?? null,
      ...findPlaceDetails(db, visit.place_id)
    };
  }

  return null;
}

export function whereWasIBetween(
  db: Database.Database,
  aliases: AliasMap,
  start: string,
  end: string
): RangeResult {
  const rows = db
    .prepare(
      `
        select s.id, s.type, s.start_time, s.end_time,
               v.place_id, v.semantic_type, v.lat as visit_lat, v.lng as visit_lng
        from segments s
        left join visits v on v.segment_id = s.id
        where s.end_time >= ? and s.start_time <= ?
        order by s.start_time asc, s.id asc
      `
    )
    .all(start, end) as Array<{
    id: number;
    type: 'visit' | 'activity' | 'timeline_path';
    start_time: string;
    end_time: string;
    place_id: string | null;
    semantic_type: string | null;
    visit_lat: number | null;
    visit_lng: number | null;
  }>;

  return {
    start,
    end,
    items: rows.map(row => ({
      segmentId: row.id,
      segmentType: row.type,
      label: resolveLabel(aliases, row.place_id, row.semantic_type, row.visit_lat, row.visit_lng, db),
      startTime: row.start_time,
      endTime: row.end_time,
      ...findPlaceDetails(db, row.place_id)
    }))
  };
}
