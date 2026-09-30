import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { TimelineConfig } from '../config.js';

export type AliasMap = {
  placeIds: Record<string, string>;
  semanticTypes?: Record<string, string>;
};

function resolveSemanticLabel(aliases: AliasMap, semanticType: string | null): string | null {
  if (!semanticType) {
    return null;
  }

  if (aliases.semanticTypes?.[semanticType]) {
    return aliases.semanticTypes[semanticType] ?? null;
  }

  if (semanticType === 'HOME') {
    return 'Home';
  }

  if (semanticType === 'WORK') {
    return 'Work';
  }

  return null;
}

export function toCoordKey(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) {
    return null;
  }

  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function buildSyntheticLabel(enriched: {
  display_name: string | null;
  road: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}): string | null {
  if (enriched.display_name) {
    return enriched.display_name;
  }

  const label = [enriched.road, enriched.suburb, enriched.city, enriched.state, enriched.country].filter(Boolean).join(', ');

  return label || null;
}

function findEnrichedLabel(db: Database.Database, placeId: string | null, lat: number | null, lng: number | null): string | null {
  if (placeId) {
    const placeName = db.prepare('select name from place_names where place_id = ?').get(placeId) as { name: string | null } | undefined;

    if (placeName?.name) {
      return placeName.name;
    }

    const enriched = db.prepare('select display_name, road, suburb, city, state, country from place_enrichment where place_id = ?').get(placeId) as
      | { display_name: string | null; road: string | null; suburb: string | null; city: string | null; state: string | null; country: string | null }
      | undefined;

    if (enriched) {
      return buildSyntheticLabel(enriched);
    }
  }

  const coordKey = toCoordKey(lat, lng);

  if (coordKey) {
    const enriched = db.prepare('select display_name, road, suburb, city, state, country from place_enrichment where coord_key = ? limit 1').get(coordKey) as
      | { display_name: string | null; road: string | null; suburb: string | null; city: string | null; state: string | null; country: string | null }
      | undefined;

    if (enriched) {
      return buildSyntheticLabel(enriched);
    }
  }

  return null;
}

export function loadAliases(config: TimelineConfig): AliasMap {
  if (!config.aliasesPath) {
    return { placeIds: {} };
  }

  const parsed = JSON.parse(readFileSync(config.aliasesPath, 'utf8')) as AliasMap;

  return {
    placeIds: parsed.placeIds ?? {},
    semanticTypes: parsed.semanticTypes ?? {}
  };
}

export function resolveLabel(
  aliases: AliasMap,
  placeId: string | null,
  semanticType: string | null,
  lat: number | null,
  lng: number | null,
  db?: Database.Database
): string {
  if (placeId && aliases.placeIds[placeId]) {
    return aliases.placeIds[placeId];
  }

  const semanticLabel = resolveSemanticLabel(aliases, semanticType);

  if (semanticLabel) {
    return semanticLabel;
  }

  if (db) {
    const enrichedLabel = findEnrichedLabel(db, placeId, lat, lng);

    if (enrichedLabel) {
      return enrichedLabel;
    }
  }

  if (semanticType) {
    return semanticType;
  }

  if (lat !== null && lng !== null) {
    return `${lat}, ${lng}`;
  }

  return 'Unknown location';
}
