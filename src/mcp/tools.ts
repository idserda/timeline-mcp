import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { Logger } from '../log.js';
import type { AliasMap } from '../query/aliases.js';
import { enrichPlaces, reverseGeocodeWithRateLimit, sleep, type EnrichedPlace } from '../query/enrich.js';
import { PLACE_DETAILS_FIELD_MASK, lookupPlaceNameWithGoogle, resolvePlaceNames, type PlaceName } from '../query/placeNames.js';
import { howDidITravel } from '../query/travel.js';
import { summarizeDay } from '../query/summarize.js';
import { whereWasIAt, whereWasIBetween } from '../query/where.js';
import { whenWasIAtPlace } from '../query/place.js';
import { searchPlaces } from '../query/placeSearch.js';

export const whereAtSchema = {
  timestamp: z.string().datetime({ offset: true })
};

export const rangeSchema = {
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true })
};

export const placeSchema = {
  place: z.string(),
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional()
};

export const searchPlacesSchema = {
  query: z.string(),
  limit: z.number().int().positive().max(100).optional()
};

export const summarizeDaySchema = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
};

export const enrichPlacesSchema = {};

export async function callWhereWasIAt(
  db: Database.Database,
  aliases: AliasMap,
  input: { timestamp: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{ type: 'text', text: JSON.stringify(whereWasIAt(db, aliases, input.timestamp), null, 2) }]
  };
}

export async function callWhereWasIBetween(
  db: Database.Database,
  aliases: AliasMap,
  input: { start: string; end: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{ type: 'text', text: JSON.stringify(whereWasIBetween(db, aliases, input.start, input.end), null, 2) }]
  };
}

export async function callWhenWasIAtPlace(
  db: Database.Database,
  aliases: AliasMap,
  input: { place: string; start?: string; end?: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{ type: 'text', text: JSON.stringify(whenWasIAtPlace(db, aliases, input.place, input.start, input.end), null, 2) }]
  };
}

export async function callSearchPlaces(
  db: Database.Database,
  aliases: AliasMap,
  input: { query: string; limit?: number }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{ type: 'text', text: JSON.stringify(searchPlaces(db, aliases, input.query, input.limit), null, 2) }]
  };
}

export async function callHowDidITravel(
  db: Database.Database,
  aliases: AliasMap,
  input: { start: string; end: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{ type: 'text', text: JSON.stringify(howDidITravel(db, aliases, input.start, input.end), null, 2) }]
  };
}

export async function callSummarizeDay(
  db: Database.Database,
  aliases: AliasMap,
  input: { date: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{ type: 'text', text: JSON.stringify(summarizeDay(db, aliases, input.date), null, 2) }]
  };
}

async function fetchNominatim(
  lat: number,
  lng: number,
  _placeId: string | null,
  userAgent: string
): Promise<Response> {
  return fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`,
    {
      headers: {
        'User-Agent': userAgent
      }
    }
  );
}

export function reverseGeocodeWithNominatim(userAgent: string, logger?: Logger): (lat: number, lng: number, placeId: string | null) => Promise<EnrichedPlace> {
  return reverseGeocodeWithRateLimit(fetchNominatim, sleep, userAgent, logger);
}

async function fetchGooglePlaceDetails(placeId: string, apiKey: string, language?: string): Promise<Response> {
  const query = language ? `?languageCode=${encodeURIComponent(language)}` : '';

  return fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${query}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK
    }
  });
}

export function lookupPlaceNameWithGooglePlaces(
  apiKey: string,
  requestsPerMinute?: number,
  language?: string,
  logger?: Logger
): (placeId: string) => Promise<PlaceName | null> {
  return lookupPlaceNameWithGoogle(placeId => fetchGooglePlaceDetails(placeId, apiKey, language), sleep, { requestsPerMinute, logger });
}

export async function callEnrichPlaces(
  db: Database.Database,
  lookup: (lat: number, lng: number, placeId: string | null) => Promise<EnrichedPlace>,
  logger?: Logger,
  placeNameLookup?: (placeId: string) => Promise<PlaceName | null>,
  language?: string
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const stats = {
    ...(await enrichPlaces(db, lookup, logger)),
    placeNames: placeNameLookup
      ? await resolvePlaceNames(db, placeNameLookup, logger, language)
      : 'skipped: TIMELINE_GOOGLE_PLACES_API_KEY not set'
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
  };
}
