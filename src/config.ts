export type TimelineConfig = {
  jsonPath: string;
  dbPath: string;
  aliasesPath?: string;
  geocoderUserAgent?: string;
  googlePlacesApiKey?: string;
  googlePlacesRequestsPerMinute?: number;
  googlePlacesLanguage?: string;
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  logFile?: string;
  httpHost?: string;
  httpPort?: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): TimelineConfig {
  const jsonPath = env.TIMELINE_JSON_PATH;
  const dbPath = env.TIMELINE_DB_PATH;
  const httpHost = env.TIMELINE_HTTP_HOST || '0.0.0.0';
  const httpPort = Number.parseInt(env.TIMELINE_HTTP_PORT ?? '3000', 10);

  if (!jsonPath) {
    throw new Error('TIMELINE_JSON_PATH is required');
  }

  if (!dbPath) {
    throw new Error('TIMELINE_DB_PATH is required');
  }

  const googlePlacesRequestsPerMinute = env.TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE
    ? Number(env.TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE)
    : undefined;

  if (googlePlacesRequestsPerMinute !== undefined && !(googlePlacesRequestsPerMinute > 0)) {
    throw new Error('TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE must be a positive number');
  }

  if (!Number.isInteger(httpPort)) {
    throw new Error('TIMELINE_HTTP_PORT must be a valid integer');
  }

  return {
    jsonPath,
    dbPath,
    aliasesPath: env.TIMELINE_ALIASES_PATH || undefined,
    geocoderUserAgent: env.TIMELINE_GEOCODER_USER_AGENT || undefined,
    googlePlacesApiKey: env.TIMELINE_GOOGLE_PLACES_API_KEY || undefined,
    googlePlacesRequestsPerMinute,
    googlePlacesLanguage: env.TIMELINE_GOOGLE_PLACES_LANGUAGE || undefined,
    logLevel: (env.TIMELINE_LOG_LEVEL as TimelineConfig['logLevel']) || undefined,
    logFile: env.TIMELINE_LOG_FILE || undefined,
    httpHost,
    httpPort
  };
}
