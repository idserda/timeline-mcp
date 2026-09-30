import type Database from 'better-sqlite3';
import type { Logger } from '../log.js';

export type PlaceName = {
  name: string | null;
  formattedAddress: string | null;
  primaryType: string | null;
  category: string | null;
  types: string[];
  city: string | null;
  postalCode: string | null;
  country: string | null;
  googleMapsUri: string | null;
  businessStatus: string | null;
};

export type PlaceNameStats = {
  resolved: number;
  notFound: number;
  // Set when Google kept rate limiting; results so far are cached and a later run picks up the rest.
  remaining?: number;
};

export type PlaceDetails = {
  category?: string;
  googleMapsUri?: string;
  businessStatus?: string;
};

// Every field here is billed at or below the Place Details Pro tier, which displayName already puts us in.
export const PLACE_DETAILS_FIELD_MASK = [
  'displayName',
  'formattedAddress',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'addressComponents',
  'googleMapsUri',
  'businessStatus'
].join(',');

type AddressComponent = {
  longText?: string;
  types?: string[];
};

type PlaceDetailsResponse = {
  ok: boolean;
  status: number;
  headers?: Headers;
  text?: () => Promise<string>;
  json: () => Promise<{
    displayName?: { text?: string };
    formattedAddress?: string;
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    types?: string[];
    addressComponents?: AddressComponent[];
    googleMapsUri?: string;
    businessStatus?: string;
  }>;
};

function findComponent(components: AddressComponent[] | undefined, ...types: string[]): string | null {
  for (const type of types) {
    const match = components?.find(component => component.types?.includes(type));

    if (match?.longText) {
      return match.longText;
    }
  }

  return null;
}

export class PlaceDetailsRateLimitError extends Error {
  constructor() {
    super('Place details lookup still rate limited after retries');
  }
}

export type GoogleLookupOptions = {
  requestsPerMinute?: number;
  maxAttempts?: number;
  logger?: Logger;
};

const MAX_BACKOFF_MS = 60_000;

async function readErrorBody(response: PlaceDetailsResponse): Promise<string | undefined> {
  try {
    return (await response.text?.())?.slice(0, 500);
  } catch {
    return undefined;
  }
}

export function lookupPlaceNameWithGoogle(
  request: (placeId: string) => Promise<PlaceDetailsResponse>,
  wait: (ms: number) => Promise<void>,
  { requestsPerMinute = 60, maxAttempts = 6, logger }: GoogleLookupOptions = {}
): (placeId: string) => Promise<PlaceName | null> {
  const minIntervalMs = requestsPerMinute > 0 ? 60_000 / requestsPerMinute : 0;
  let lastRequestAt = 0;

  return async (placeId: string) => {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const elapsed = Date.now() - lastRequestAt;

      if (lastRequestAt !== 0 && elapsed < minIntervalMs) {
        await wait(minIntervalMs - elapsed);
      }

      lastRequestAt = Date.now();
      const response = await request(placeId);

      if (response.ok) {
        const payload = await response.json();

        logger?.debug('place details success', { placeId, name: payload.displayName?.text, type: payload.primaryType });

        return {
          name: payload.displayName?.text ?? null,
          formattedAddress: payload.formattedAddress ?? null,
          primaryType: payload.primaryType ?? null,
          category: payload.primaryTypeDisplayName?.text ?? null,
          types: payload.types ?? [],
          city: findComponent(payload.addressComponents, 'locality', 'postal_town', 'administrative_area_level_2'),
          postalCode: findComponent(payload.addressComponents, 'postal_code'),
          country: findComponent(payload.addressComponents, 'country'),
          googleMapsUri: payload.googleMapsUri ?? null,
          businessStatus: payload.businessStatus ?? null
        };
      }

      if (response.status === 404) {
        logger?.warn('place details not found', { placeId });
        return null;
      }

      attempts += 1;

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers?.get('retry-after'));
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
        logger?.warn('place details retry scheduled', {
          placeId,
          status: response.status,
          delayMs: delay,
          attempt: attempts,
          body: await readErrorBody(response)
        });

        if (attempts < maxAttempts) {
          await wait(delay);
        }

        continue;
      }

      logger?.error('place details failed', { placeId, status: response.status, body: await readErrorBody(response) });
      throw new Error(`Place details lookup failed: ${response.status}`);
    }

    logger?.error('place details failed after retries', { placeId });
    throw new PlaceDetailsRateLimitError();
  };
}

export async function resolvePlaceNames(
  db: Database.Database,
  lookup: (placeId: string) => Promise<PlaceName | null>,
  logger?: Logger,
  language = ''
): Promise<PlaceNameStats> {
  // Rows without fetched_at were cached before the extra detail fields existed, and rows in another
  // language were fetched before the language setting changed; both are looked up again.
  const rows = db
    .prepare(
      `
        select distinct v.place_id
        from visits v
        left join place_names n on n.place_id = v.place_id
        where v.place_id is not null
          and (n.place_id is null or n.fetched_at is null or coalesce(n.language, '') != ?)
      `
    )
    .all(language) as Array<{ place_id: string }>;

  const upsert = db.prepare(
    `
      insert into place_names(
        place_id, name, formatted_address, primary_type, category, types, city, postal_code, country,
        google_maps_uri, business_status, language, fetched_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(place_id) do update set
        name = excluded.name,
        formatted_address = excluded.formatted_address,
        primary_type = excluded.primary_type,
        category = excluded.category,
        types = excluded.types,
        city = excluded.city,
        postal_code = excluded.postal_code,
        country = excluded.country,
        google_maps_uri = excluded.google_maps_uri,
        business_status = excluded.business_status,
        language = excluded.language,
        fetched_at = excluded.fetched_at
    `
  );
  const stats: PlaceNameStats = { resolved: 0, notFound: 0 };

  logger?.info('place name resolution started', { candidates: rows.length });

  for (const [index, row] of rows.entries()) {
    let result: PlaceName | null;

    try {
      result = await lookup(row.place_id);
    } catch (error) {
      if (error instanceof PlaceDetailsRateLimitError) {
        stats.remaining = rows.length - index;
        logger?.warn('place name resolution stopped by rate limit', stats);
        return stats;
      }

      throw error;
    }

    // Cache misses too, so stale place ids are not looked up again on every run.
    upsert.run(
      row.place_id,
      result?.name ?? null,
      result?.formattedAddress ?? null,
      result?.primaryType ?? null,
      result?.category ?? null,
      result ? JSON.stringify(result.types) : null,
      result?.city ?? null,
      result?.postalCode ?? null,
      result?.country ?? null,
      result?.googleMapsUri ?? null,
      result?.businessStatus ?? null,
      language,
      new Date().toISOString()
    );

    if (result) {
      stats.resolved += 1;
    } else {
      stats.notFound += 1;
    }
  }

  logger?.info('place name resolution complete', stats);

  return stats;
}

export function findPlaceDetails(db: Database.Database, placeId: string | null): PlaceDetails {
  if (!placeId) {
    return {};
  }

  const row = db.prepare('select category, google_maps_uri, business_status from place_names where place_id = ?').get(placeId) as
    | { category: string | null; google_maps_uri: string | null; business_status: string | null }
    | undefined;

  if (!row) {
    return {};
  }

  return {
    ...(row.category ? { category: row.category } : {}),
    ...(row.google_maps_uri ? { googleMapsUri: row.google_maps_uri } : {}),
    // OPERATIONAL is the normal case; only surface closures.
    ...(row.business_status && row.business_status !== 'OPERATIONAL' ? { businessStatus: row.business_status } : {})
  };
}
