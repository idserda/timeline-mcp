import type Database from 'better-sqlite3';
import { resolveLabel, toCoordKey, type AliasMap } from './aliases.js';
import { findPlaceDetails, type PlaceDetails } from './placeNames.js';

export type PlaceSummary = {
  // Google place id, or a rounded "lat,lng" key for visits without one.
  placeKey: string;
  label: string;
  name?: string;
  address?: string;
  city?: string;
  visitCount: number;
  firstVisit: string;
  lastVisit: string;
} & PlaceDetails;

export type PlaceSearchResult = {
  query: string;
  places: PlaceSummary[];
};

type CatalogPlace = PlaceSummary & {
  haystack: string;
};

// Filler words dropped from queries like "Bakker in Meppel" or "the station at Utrecht".
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'at',
  'of',
  'on',
  'near',
  'by',
  'to',
  'de',
  'het',
  'een',
  'bij',
  'te',
  'op',
  'van',
  'aan',
  'naar',
  'nabij'
]);

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function tokenize(query: string): string[] {
  const terms = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const meaningful = terms.filter(term => !STOPWORDS.has(term));

  // A query made only of stopwords ("in") would otherwise match everything.
  return meaningful.length > 0 ? meaningful : terms;
}

function matchesAll(haystack: string, terms: string[]): boolean {
  return terms.length > 0 && terms.every(term => haystack.includes(term));
}

function loadCatalog(db: Database.Database, aliases: AliasMap): CatalogPlace[] {
  const places = db
    .prepare(
      `
        select coalesce(v.place_id, printf('%.3f,%.3f', v.lat, v.lng)) as place_key,
               v.place_id, max(v.semantic_type) as semantic_type, min(v.lat) as lat, min(v.lng) as lng,
               count(*) as visit_count, min(s.start_time) as first_visit, max(s.start_time) as last_visit
        from visits v
        join segments s on s.id = v.segment_id
        where v.place_id is not null or (v.lat is not null and v.lng is not null)
        group by place_key
      `
    )
    .all() as Array<{
    place_key: string;
    place_id: string | null;
    semantic_type: string | null;
    lat: number | null;
    lng: number | null;
    visit_count: number;
    first_visit: string;
    last_visit: string;
  }>;

  const nameStatement = db.prepare(
    'select name, formatted_address, category, primary_type, types, city, postal_code, country from place_names where place_id = ?'
  );
  const enrichmentStatement = db.prepare(
    `
      select display_name, road, neighbourhood, suburb, city, state, country
      from place_enrichment
      where place_id = ? or coord_key = ?
      order by place_id is null
      limit 1
    `
  );

  return places.map(place => {
    const coordKey = toCoordKey(place.lat, place.lng);
    const googlePlace = (place.place_id ? nameStatement.get(place.place_id) : undefined) as
      | {
          name: string | null;
          formatted_address: string | null;
          category: string | null;
          primary_type: string | null;
          types: string | null;
          city: string | null;
          postal_code: string | null;
          country: string | null;
        }
      | undefined;
    const osmPlace = enrichmentStatement.get(place.place_id, coordKey) as Record<string, string | null> | undefined;
    const label = resolveLabel(aliases, place.place_id, place.semantic_type, place.lat, place.lng, db);
    const types = googlePlace?.types ? (JSON.parse(googlePlace.types) as string[]) : [];

    const haystack = normalize(
      [
        label,
        place.place_id,
        place.semantic_type,
        coordKey,
        googlePlace?.name,
        googlePlace?.formatted_address,
        googlePlace?.category,
        googlePlace?.city,
        googlePlace?.postal_code,
        googlePlace?.country,
        // "fast_food_restaurant" becomes searchable as "fast food restaurant".
        ...types.map(type => type.replace(/_/g, ' ')),
        ...Object.values(osmPlace ?? {})
      ]
        .filter(Boolean)
        .join(' | ')
    );

    const city = googlePlace?.city ?? osmPlace?.city ?? undefined;

    return {
      placeKey: place.place_key,
      label,
      ...(googlePlace?.name ? { name: googlePlace.name } : {}),
      ...(googlePlace?.formatted_address ? { address: googlePlace.formatted_address } : {}),
      ...(city ? { city } : {}),
      visitCount: place.visit_count,
      firstVisit: place.first_visit,
      lastVisit: place.last_visit,
      ...findPlaceDetails(db, place.place_id),
      haystack
    };
  });
}

// Every query word must appear somewhere in the place's name, address, city, category, or types.
export function findMatchingPlaces(db: Database.Database, aliases: AliasMap, query: string): PlaceSummary[] {
  const terms = tokenize(query);

  return loadCatalog(db, aliases)
    .filter(place => matchesAll(place.haystack, terms))
    .map(({ haystack: _haystack, ...place }) => place);
}

export function searchPlaces(db: Database.Database, aliases: AliasMap, query: string, limit = 20): PlaceSearchResult {
  return {
    query,
    places: findMatchingPlaces(db, aliases, query)
      .sort((a, b) => b.visitCount - a.visitCount || b.lastVisit.localeCompare(a.lastVisit))
      .slice(0, limit)
  };
}
