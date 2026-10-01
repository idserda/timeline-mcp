import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reads required env vars', () => {
    expect(
      loadConfig({
        TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json',
        TIMELINE_DB_PATH: '/tmp/timeline.db',
        TIMELINE_ALIASES_PATH: '/tmp/aliases.json',
        TIMELINE_GEOCODER_USER_AGENT: 'timeline-mcp-test/1.0',
        TIMELINE_LOG_LEVEL: 'DEBUG',
        TIMELINE_LOG_FILE: '/tmp/timeline.log'
      })
    ).toEqual({
      jsonPath: '/tmp/Tijdlijn.json',
      dbPath: '/tmp/timeline.db',
      aliasesPath: '/tmp/aliases.json',
      geocoderUserAgent: 'timeline-mcp-test/1.0',
      logLevel: 'DEBUG',
      logFile: '/tmp/timeline.log',
      transport: 'stdio',
      httpHost: '0.0.0.0',
      httpPort: 3000
    });
  });

  it('throws when json path missing', () => {
    expect(() => loadConfig({ TIMELINE_DB_PATH: '/tmp/timeline.db' })).toThrow(
      'TIMELINE_JSON_PATH is required'
    );
  });

  it('throws when db path missing', () => {
    expect(() => loadConfig({ TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json' })).toThrow(
      'TIMELINE_DB_PATH is required'
    );
  });

  it('reads optional geocoder user agent', () => {
    expect(
      loadConfig({
        TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json',
        TIMELINE_DB_PATH: '/tmp/timeline.db',
        TIMELINE_ALIASES_PATH: '/tmp/aliases.json',
        TIMELINE_GEOCODER_USER_AGENT: 'timeline-mcp-test/1.0',
        TIMELINE_LOG_LEVEL: 'DEBUG',
        TIMELINE_LOG_FILE: '/tmp/timeline.log'
      })
    ).toMatchObject({
      geocoderUserAgent: 'timeline-mcp-test/1.0'
    });
  });

  it('reads optional logging config', () => {
    expect(
      loadConfig({
        TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json',
        TIMELINE_DB_PATH: '/tmp/timeline.db',
        TIMELINE_LOG_LEVEL: 'WARN',
        TIMELINE_LOG_FILE: '/tmp/timeline.log'
      })
    ).toMatchObject({
      logLevel: 'WARN',
      logFile: '/tmp/timeline.log'
    });
  });

  it('reads optional HTTP config', () => {
    expect(
      loadConfig({
        TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json',
        TIMELINE_DB_PATH: '/tmp/timeline.db',
        TIMELINE_HTTP_HOST: '192.168.1.10',
        TIMELINE_HTTP_PORT: '4100'
      })
    ).toMatchObject({
      httpHost: '192.168.1.10',
      httpPort: 4100
    });
  });

  it('throws on invalid HTTP port', () => {
    expect(() =>
      loadConfig({
        TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json',
        TIMELINE_DB_PATH: '/tmp/timeline.db',
        TIMELINE_HTTP_PORT: 'abc'
      })
    ).toThrow('TIMELINE_HTTP_PORT must be a valid integer');
  });

  it('reads transport', () => {
    const base = { TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json', TIMELINE_DB_PATH: '/tmp/timeline.db' };

    expect(loadConfig({ ...base, TIMELINE_TRANSPORT: 'stdio' }).transport).toBe('stdio');
    expect(() => loadConfig({ ...base, TIMELINE_TRANSPORT: 'sse' })).toThrow('TIMELINE_TRANSPORT must be "http" or "stdio"');
  });

  it('reads google places requests per minute', () => {
    const base = { TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json', TIMELINE_DB_PATH: '/tmp/timeline.db' };

    expect(loadConfig({ ...base, TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE: '30' }).googlePlacesRequestsPerMinute).toBe(30);
    expect(() => loadConfig({ ...base, TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE: 'abc' })).toThrow(
      'TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE must be a positive number'
    );
  });

  it('reads google places language', () => {
    expect(
      loadConfig({ TIMELINE_JSON_PATH: '/tmp/Tijdlijn.json', TIMELINE_DB_PATH: '/tmp/timeline.db', TIMELINE_GOOGLE_PLACES_LANGUAGE: 'nl' })
        .googlePlacesLanguage
    ).toBe('nl');
  });
});
