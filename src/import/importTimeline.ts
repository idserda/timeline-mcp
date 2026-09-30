import { readFileSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { TimelineConfig } from '../config.js';
import type { Logger } from '../log.js';
import { parseLatLng, parseTimelineDocument } from './parseTimeline.js';

export type ImportStats = {
  segmentCount: number;
  visitCount: number;
  activityCount: number;
  pathPointCount: number;
};

type TimelineSegment = {
  startTime: string;
  endTime: string;
  startTimeTimezoneUtcOffsetMinutes?: number;
  endTimeTimezoneUtcOffsetMinutes?: number;
  visit?: {
    topCandidate?: {
      placeId?: string;
      semanticType?: string;
      probability?: number;
      placeLocation?: { latLng?: string };
    };
  };
  activity?: {
    start?: { latLng?: string };
    end?: { latLng?: string };
    distanceMeters?: number;
    topCandidate?: { type?: string; probability?: number };
  };
  timelinePath?: Array<{ point?: string; time: string }>;
};

function insertMetadata(db: Database.Database, key: string, value: string): void {
  db.prepare('insert into metadata(key, value) values (?, ?)').run(key, value);
}

export function rebuildTimelineIndex(db: Database.Database, config: TimelineConfig, logger?: Logger): ImportStats {
  logger?.info('timeline import started', { sourcePath: config.jsonPath });
  const document = parseTimelineDocument(readFileSync(config.jsonPath, 'utf8'));
  const insertSegment = db.prepare(
    'insert into segments(type, start_time, end_time, start_tz_offset_minutes, end_tz_offset_minutes, raw_json) values (?, ?, ?, ?, ?, ?)'
  );
  const insertVisit = db.prepare(
    'insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)'
  );
  const insertActivity = db.prepare(
    'insert into activities(segment_id, start_lat, start_lng, end_lat, end_lng, distance_meters, activity_type, probability) values (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPathPoint = db.prepare(
    'insert into path_points(segment_id, sequence_index, point_time, lat, lng) values (?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    db.exec('delete from path_points; delete from activities; delete from visits; delete from segments; delete from metadata;');

    for (const rawSegment of document.semanticSegments) {
      const segment = rawSegment as unknown as TimelineSegment;
      const type = segment.visit ? 'visit' : segment.activity ? 'activity' : 'timeline_path';
      const segmentId = Number(
        insertSegment.run(
          type,
          segment.startTime,
          segment.endTime,
          segment.startTimeTimezoneUtcOffsetMinutes ?? null,
          segment.endTimeTimezoneUtcOffsetMinutes ?? null,
          JSON.stringify(segment)
        ).lastInsertRowid
      );

      if (segment.visit) {
        const candidate = segment.visit.topCandidate;
        const point = parseLatLng(candidate?.placeLocation?.latLng);
        insertVisit.run(
          segmentId,
          candidate?.placeId ?? null,
          candidate?.semanticType ?? null,
          candidate?.probability ?? null,
          point.lat,
          point.lng
        );
      }

      if (segment.activity) {
        const start = parseLatLng(segment.activity.start?.latLng);
        const end = parseLatLng(segment.activity.end?.latLng);
        insertActivity.run(
          segmentId,
          start.lat,
          start.lng,
          end.lat,
          end.lng,
          segment.activity.distanceMeters ?? null,
          segment.activity.topCandidate?.type ?? null,
          segment.activity.topCandidate?.probability ?? null
        );
      }

      if (segment.timelinePath) {
        for (const [index, point] of segment.timelinePath.entries()) {
          const parsed = parseLatLng(point.point);
          insertPathPoint.run(segmentId, index, point.time, parsed.lat, parsed.lng);
        }
      }
    }

    const source = statSync(config.jsonPath);
    insertMetadata(db, 'sourcePath', config.jsonPath);
    insertMetadata(db, 'sourceSize', String(source.size));
    insertMetadata(db, 'sourceMtimeMs', String(source.mtimeMs));
    insertMetadata(db, 'importedAt', new Date().toISOString());
    insertMetadata(db, 'schemaVersion', '1');
  });

  transaction();

  const stats = {
    segmentCount: (db.prepare('select count(*) as count from segments').get() as { count: number }).count,
    visitCount: (db.prepare('select count(*) as count from visits').get() as { count: number }).count,
    activityCount: (db.prepare('select count(*) as count from activities').get() as { count: number }).count,
    pathPointCount: (db.prepare('select count(*) as count from path_points').get() as { count: number }).count
  };

  logger?.info('timeline import complete', stats);

  return stats;
}
