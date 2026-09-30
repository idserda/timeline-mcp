import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/server';
import type { TimelineConfig } from '../config.js';
import { createLogger } from '../log.js';
import type { AliasMap } from '../query/aliases.js';
import { getStatsResource, readDayResource, readSegmentResource } from './resources.js';
import {
  callEnrichPlaces,
  callHowDidITravel,
  callSearchPlaces,
  callSummarizeDay,
  callWhenWasIAtPlace,
  callWhereWasIAt,
  callWhereWasIBetween,
  enrichPlacesSchema,
  lookupPlaceNameWithGooglePlaces,
  placeSchema,
  rangeSchema,
  searchPlacesSchema,
  reverseGeocodeWithNominatim,
  summarizeDaySchema,
  whereAtSchema
} from './tools.js';

export type ServerDeps = {
  config: TimelineConfig;
  db: Database.Database;
  aliases: AliasMap;
};

export function buildMcpServer({ config, db, aliases }: ServerDeps): McpServer {
  const server = new McpServer({ name: 'timeline-mcp', version: '0.1.0' });
  const logger = createLogger(config.logLevel ?? 'INFO', config.logFile);

  server.registerTool('where_was_i_at', { description: 'Find best matching location for a timestamp', inputSchema: whereAtSchema }, (input: { timestamp: string }) =>
    callWhereWasIAt(db, aliases, input)
  );
  server.registerTool('where_was_i_between', { description: 'Find timeline segments in a time range', inputSchema: rangeSchema }, (input: { start: string; end: string }) =>
    callWhereWasIBetween(db, aliases, input)
  );
  server.registerTool(
    'search_places',
    {
      description:
        'Search visited places by name, category, address, or city (e.g. "bakker Meppel", "supermarket", "Utrecht"). Every word must match. Returns distinct places with visit counts and first/last visit, so you can pick the right one before asking when_was_i_at_place.',
      inputSchema: searchPlacesSchema
    },
    (input: { query: string; limit?: number }) => callSearchPlaces(db, aliases, input)
  );
  server.registerTool(
    'when_was_i_at_place',
    {
      description:
        'List visits to places matching a query, optionally within a time range. Every word in the query must match the place name, category, address, or city (e.g. "bakker Meppel"). A placeKey from search_places also works.',
      inputSchema: placeSchema
    },
    (input: { place: string; start?: string; end?: string }) => callWhenWasIAtPlace(db, aliases, input)
  );
  server.registerTool('how_did_i_travel', { description: 'Summarize travel in a time range', inputSchema: rangeSchema }, (input: { start: string; end: string }) =>
    callHowDidITravel(db, aliases, input)
  );
  server.registerTool('summarize_day', { description: 'Summarize a calendar day', inputSchema: summarizeDaySchema }, (input: { date: string }) =>
    callSummarizeDay(db, aliases, input)
  );
  server.registerTool(
    'enrich_places',
    {
      description: 'Reverse geocode stored visit places and resolve Google place ids to names (when a Places API key is configured), caching results',
      inputSchema: enrichPlacesSchema
    },
    () =>
      callEnrichPlaces(
        db,
        reverseGeocodeWithNominatim(config.geocoderUserAgent ?? 'timeline-mcp/0.1.0', logger),
        logger,
        config.googlePlacesApiKey
          ? lookupPlaceNameWithGooglePlaces(
              config.googlePlacesApiKey,
              config.googlePlacesRequestsPerMinute,
              config.googlePlacesLanguage,
              logger
            )
          : undefined,
        config.googlePlacesLanguage
      )
  );

  server.registerResource('timeline-stats', 'timeline://stats', { title: 'Timeline stats', mimeType: 'application/json' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(getStatsResource(db), null, 2) }]
  }));

  server.registerResource('timeline-day', 'timeline://day/{date}', { title: 'Timeline day', mimeType: 'application/json' }, async uri => {
    const date = uri.pathname.split('/').pop() ?? '';
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(readDayResource(db, aliases, date), null, 2) }]
    };
  });

  server.registerResource('timeline-segment', 'timeline://segment/{id}', { title: 'Timeline segment', mimeType: 'application/json' }, async uri => {
    const id = Number(uri.pathname.split('/').pop() ?? '0');
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(readSegmentResource(db, id), null, 2) }]
    };
  });

  return server;
}
