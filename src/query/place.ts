import type Database from 'better-sqlite3';
import type { AliasMap } from './aliases.js';
import type { PlaceDetails } from './placeNames.js';
import { findMatchingPlaces } from './placeSearch.js';

export type PlaceMatches = {
  place: string;
  items: Array<{
    startTime: string;
    endTime: string;
    label: string;
    coordinates: { lat: number; lng: number } | null;
  } & PlaceDetails>;
};

export function whenWasIAtPlace(
  db: Database.Database,
  aliases: AliasMap,
  place: string,
  start?: string,
  end?: string
): PlaceMatches {
  const places = new Map(findMatchingPlaces(db, aliases, place).map(match => [match.placeKey, match]));

  if (places.size === 0) {
    return { place, items: [] };
  }

  const rows = db
    .prepare(
      `
        select s.start_time, s.end_time, v.lat, v.lng,
               coalesce(v.place_id, printf('%.3f,%.3f', v.lat, v.lng)) as place_key
        from segments s
        join visits v on v.segment_id = s.id
        where coalesce(v.place_id, printf('%.3f,%.3f', v.lat, v.lng)) in (select value from json_each(?))
          and (? is null or s.end_time >= ?)
          and (? is null or s.start_time <= ?)
        order by s.start_time asc
      `
    )
    .all(JSON.stringify([...places.keys()]), start ?? null, start ?? null, end ?? null, end ?? null) as Array<{
    start_time: string;
    end_time: string;
    lat: number | null;
    lng: number | null;
    place_key: string;
  }>;

  return {
    place,
    items: rows.map(row => {
      const { label, category, googleMapsUri, businessStatus } = places.get(row.place_key)!;

      return {
        startTime: row.start_time,
        endTime: row.end_time,
        label,
        coordinates: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
        ...(category ? { category } : {}),
        ...(googleMapsUri ? { googleMapsUri } : {}),
        ...(businessStatus ? { businessStatus } : {})
      };
    })
  };
}
