import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { whenWasIAtPlace } from '../src/query/place.js';
import { resolvePlaceNames, type PlaceName } from '../src/query/placeNames.js';
import { searchPlaces, tokenize } from '../src/query/placeSearch.js';

const places: Record<string, Partial<PlaceName>> = {
  'bakker-meppel': {
    name: 'Bakkerij Jansen',
    formattedAddress: 'Hoofdstraat 1, 7941 AA Meppel',
    category: 'Bakkerij',
    types: ['bakery', 'food', 'store'],
    city: 'Meppel'
  },
  'bakker-zwolle': {
    name: 'Bakker Bart',
    formattedAddress: 'Diezerstraat 5, 8011 RE Zwolle',
    category: 'Bakkerij',
    types: ['bakery', 'food', 'store'],
    city: 'Zwolle'
  },
  'ah-meppel': {
    name: 'Albert Heijn',
    formattedAddress: 'Kerkplein 3, 7941 BB Meppel',
    category: 'Supermarkt',
    types: ['supermarket', 'grocery_store', 'store'],
    city: 'Meppel'
  },
  'cafe-zwolle': {
    name: 'Café de Kroon',
    formattedAddress: 'Grote Markt 2, 8011 LV Zwolle',
    category: 'Café',
    types: ['cafe', 'fast_food_restaurant'],
    city: 'Zwolle'
  }
};

async function buildDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  ensureSchema(db);

  const visits: Array<[string, string]> = [
    ['bakker-meppel', '2024-01-01T09:00:00+01:00'],
    ['bakker-meppel', '2024-02-01T09:00:00+01:00'],
    ['bakker-zwolle', '2024-01-05T09:00:00+01:00'],
    ['ah-meppel', '2024-01-02T09:00:00+01:00'],
    ['cafe-zwolle', '2024-01-03T09:00:00+01:00']
  ];

  visits.forEach(([placeId, start], index) => {
    const end = start.replace('T09:', 'T10:');
    db.prepare('insert into segments(id, type, start_time, end_time, raw_json) values (?, ?, ?, ?, ?)').run(index + 1, 'visit', start, end, '{}');
    db.prepare('insert into visits(segment_id, place_id, semantic_type, probability, lat, lng) values (?, ?, ?, ?, ?, ?)').run(
      index + 1,
      placeId,
      'UNKNOWN',
      0.9,
      52.6 + index / 100,
      6.2
    );
  });

  await resolvePlaceNames(db, async placeId => ({
    name: null,
    formattedAddress: null,
    primaryType: null,
    category: null,
    types: [],
    city: null,
    postalCode: null,
    country: 'Nederland',
    googleMapsUri: `https://maps.google.com/?q=${placeId}`,
    businessStatus: 'OPERATIONAL',
    ...places[placeId]
  }));

  return db;
}

function labels(result: { items: Array<{ label: string }> }): string[] {
  return result.items.map(item => item.label);
}

describe('tokenize', () => {
  it('drops stopwords and diacritics', () => {
    expect(tokenize('Bakker in Meppel')).toEqual(['bakker', 'meppel']);
    expect(tokenize('Café bij de Markt')).toEqual(['cafe', 'markt']);
    expect(tokenize('in')).toEqual(['in']);
  });
});

describe('whenWasIAtPlace', () => {
  it('matches every word across name and city', async () => {
    const db = await buildDb();

    expect(labels(whenWasIAtPlace(db, { placeIds: {} }, 'Bakker in Meppel'))).toEqual(['Bakkerij Jansen', 'Bakkerij Jansen']);
    expect(labels(whenWasIAtPlace(db, { placeIds: {} }, 'bakery Zwolle'))).toEqual(['Bakker Bart']);
    expect(labels(whenWasIAtPlace(db, { placeIds: {} }, 'supermarkt meppel'))).toEqual(['Albert Heijn']);
  });

  it('matches cities, categories, types, and ignores accents', async () => {
    const db = await buildDb();

    expect(whenWasIAtPlace(db, { placeIds: {} }, 'Meppel').items).toHaveLength(3);
    expect(whenWasIAtPlace(db, { placeIds: {} }, 'bakery').items).toHaveLength(3);
    expect(labels(whenWasIAtPlace(db, { placeIds: {} }, 'cafe'))).toEqual(['Café de Kroon']);
    expect(labels(whenWasIAtPlace(db, { placeIds: {} }, 'fast food restaurant'))).toEqual(['Café de Kroon']);
    expect(whenWasIAtPlace(db, { placeIds: {} }, 'bakker Amsterdam').items).toHaveLength(0);
  });

  it('respects the time range and returns visit details', async () => {
    const db = await buildDb();
    const result = whenWasIAtPlace(db, { placeIds: {} }, 'Bakker Meppel', '2024-01-15T00:00:00+01:00');

    expect(result.items).toEqual([
      {
        startTime: '2024-02-01T09:00:00+01:00',
        endTime: '2024-02-01T10:00:00+01:00',
        label: 'Bakkerij Jansen',
        coordinates: { lat: 52.61, lng: 6.2 },
        category: 'Bakkerij',
        googleMapsUri: 'https://maps.google.com/?q=bakker-meppel'
      }
    ]);
  });

  it('accepts a place key from search_places', async () => {
    const db = await buildDb();

    expect(labels(whenWasIAtPlace(db, { placeIds: {} }, 'ah-meppel'))).toEqual(['Albert Heijn']);
  });
});

describe('searchPlaces', () => {
  it('returns distinct places ordered by visit count', async () => {
    const db = await buildDb();
    const result = searchPlaces(db, { placeIds: {} }, 'bakker');

    expect(result.places.map(place => [place.label, place.visitCount])).toEqual([
      ['Bakkerij Jansen', 2],
      ['Bakker Bart', 1]
    ]);
    expect(result.places[0]).toMatchObject({
      placeKey: 'bakker-meppel',
      name: 'Bakkerij Jansen',
      address: 'Hoofdstraat 1, 7941 AA Meppel',
      city: 'Meppel',
      category: 'Bakkerij',
      firstVisit: '2024-01-01T09:00:00+01:00',
      lastVisit: '2024-02-01T09:00:00+01:00'
    });
  });

  it('applies the limit', async () => {
    const db = await buildDb();

    expect(searchPlaces(db, { placeIds: {} }, 'nederland', 2).places).toHaveLength(2);
  });
});

describe('resolvePlaceNames language', () => {
  it('refetches places cached in another language', async () => {
    const db = await buildDb();
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return null;
    };

    await resolvePlaceNames(db, lookup);
    expect(calls).toBe(0);

    await resolvePlaceNames(db, lookup, undefined, 'nl');
    expect(calls).toBe(4);

    await resolvePlaceNames(db, lookup, undefined, 'nl');
    expect(calls).toBe(4);
  });
});
