import type Database from 'better-sqlite3';

export function ensureSchema(db: Database.Database): void {
  db.exec(`
    create table if not exists segments (
      id integer primary key autoincrement,
      type text not null,
      start_time text not null,
      end_time text not null,
      start_tz_offset_minutes integer,
      end_tz_offset_minutes integer,
      raw_json text not null
    );

    create table if not exists visits (
      segment_id integer not null,
      place_id text,
      semantic_type text,
      probability real,
      lat real,
      lng real,
      foreign key (segment_id) references segments(id)
    );

    create table if not exists activities (
      segment_id integer not null,
      start_lat real,
      start_lng real,
      end_lat real,
      end_lng real,
      distance_meters real,
      activity_type text,
      probability real,
      foreign key (segment_id) references segments(id)
    );

    create table if not exists path_points (
      segment_id integer not null,
      sequence_index integer not null,
      point_time text not null,
      lat real,
      lng real,
      foreign key (segment_id) references segments(id)
    );

    create table if not exists metadata (
      key text primary key,
      value text not null
    );

    create table if not exists place_enrichment (
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

    create table if not exists place_names (
      place_id text primary key,
      name text,
      formatted_address text
    );

    create index if not exists idx_segments_time on segments(start_time, end_time);
    create index if not exists idx_visits_place_id on visits(place_id);
    create index if not exists idx_visits_semantic_type on visits(semantic_type);
    create index if not exists idx_path_points_time on path_points(point_time);
  `);

  const placeEnrichmentColumns = db.prepare("pragma table_info('place_enrichment')").all() as Array<{ name: string }>;

  if (!placeEnrichmentColumns.some(column => column.name === 'coord_key')) {
    db.exec('alter table place_enrichment add column coord_key text');
  }

  const placeNameColumns = new Set(
    (db.prepare("pragma table_info('place_names')").all() as Array<{ name: string }>).map(column => column.name)
  );

  for (const column of [
    'primary_type',
    'category',
    'types',
    'city',
    'postal_code',
    'country',
    'google_maps_uri',
    'business_status',
    'language',
    'fetched_at'
  ]) {
    if (!placeNameColumns.has(column)) {
      db.exec(`alter table place_names add column ${column} text`);
    }
  }

  db.exec(`
    create index if not exists idx_place_names_primary_type on place_names(primary_type);
    create index if not exists idx_place_enrichment_city on place_enrichment(city);
    create index if not exists idx_place_enrichment_coord_key on place_enrichment(coord_key);
  `);
}
