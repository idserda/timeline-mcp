import type Database from 'better-sqlite3';
import type { Logger } from '../log.js';
import { toCoordKey } from './aliases.js';

export type EnrichedPlace = {
  displayName: string | null;
  road: string | null;
  neighbourhood: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

export type EnrichStats = {
  enriched: number;
  skipped: number;
};

type ReverseGeocodeResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<{
    display_name?: string;
    address?: {
      road?: string;
      neighbourhood?: string;
      suburb?: string;
      city?: string;
      town?: string;
      village?: string;
      state?: string;
      country?: string;
    };
  }>;
};

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function reverseGeocodeWithRateLimit(
  request: (lat: number, lng: number, placeId: string | null, userAgent: string) => Promise<ReverseGeocodeResponse>,
  wait: (ms: number) => Promise<void>,
  userAgent: string,
  logger?: Logger
): (lat: number, lng: number, placeId: string | null) => Promise<EnrichedPlace> {
  let lastRequestAt = 0;

  return async (lat: number, lng: number, placeId: string | null) => {
    const now = Date.now();
    const elapsed = now - lastRequestAt;

    if (lastRequestAt !== 0 && elapsed < 1000) {
      logger?.debug('reverse geocode rate limit wait', { waitMs: 1000 - elapsed, placeId });
      await wait(1000 - elapsed);
    }

    let attempts = 0;

    while (attempts < 3) {
      lastRequestAt = Date.now();
      const response = await request(lat, lng, placeId, userAgent);

      if (response.ok) {
        const payload = await response.json();

        logger?.debug('reverse geocode success', { placeId, lat, lng });

        return {
          displayName: payload.display_name ?? null,
          road: payload.address?.road ?? null,
          neighbourhood: payload.address?.neighbourhood ?? null,
          suburb: payload.address?.suburb ?? null,
          city: payload.address?.city ?? payload.address?.town ?? payload.address?.village ?? null,
          state: payload.address?.state ?? null,
          country: payload.address?.country ?? null
        };
      }

      attempts += 1;

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter ? Number(retryAfter) * 1000 : attempts * 1000;
        logger?.warn('reverse geocode retry scheduled', { placeId, status: response.status, delayMs: delay, attempt: attempts });
        await wait(delay);
        continue;
      }

      logger?.error('reverse geocode failed', { placeId, status: response.status });
      throw new Error(`Reverse geocoding failed: ${response.status}`);
    }

    logger?.error('reverse geocode failed after retries', { placeId, lat, lng });
    throw new Error('Reverse geocoding failed after retries');
  };
}

export async function enrichPlaces(
  db: Database.Database,
  lookup: (lat: number, lng: number, placeId: string | null) => Promise<EnrichedPlace>,
  logger?: Logger
): Promise<EnrichStats> {
  const rows = db.prepare(
    `
      select v.place_id, min(v.lat) as lat, min(v.lng) as lng
      from visits v
      left join place_enrichment p on p.place_id = v.place_id or p.coord_key = printf('%.3f,%.3f', v.lat, v.lng)
      where v.lat is not null and v.lng is not null
      group by coalesce(v.place_id, printf('%.3f,%.3f', v.lat, v.lng))
      having max(case when p.place_id is not null then 1 else 0 end) = 0
    `
  ).all() as Array<{
    place_id: string | null;
    lat: number;
    lng: number;
  }>;

  const totalCandidates = (db.prepare('select count(distinct place_id) as count from visits').get() as { count: number }).count;
  let enriched = 0;

  logger?.info('enrichment started', { candidates: rows.length, totalPlaces: totalCandidates });

  for (const row of rows) {
    const result = await lookup(row.lat, row.lng, row.place_id);
    db.prepare(
      `
        insert into place_enrichment(
          place_id, lat, lng, coord_key, display_name, road, neighbourhood, suburb, city, state, country
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.place_id,
      row.lat,
      row.lng,
      toCoordKey(row.lat, row.lng),
      result.displayName,
      result.road,
      result.neighbourhood,
      result.suburb,
      result.city,
      result.state,
      result.country
    );
    enriched += 1;
    logger?.debug('place enriched', { placeId: row.place_id, label: result.displayName, city: result.city });
  }

  const stats = {
    enriched,
    skipped: totalCandidates - enriched
  };

  logger?.info('enrichment complete', stats);

  return stats;
}
