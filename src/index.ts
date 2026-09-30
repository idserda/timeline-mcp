import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { isIndexStale } from './db/freshness.js';
import { ensureSchema } from './db/schema.js';
import { startHttpServer } from './http.js';
import { rebuildTimelineIndex } from './import/importTimeline.js';
import { createLogger } from './log.js';
import { loadAliases } from './query/aliases.js';

export async function startRuntime(options?: {
  env?: NodeJS.ProcessEnv;
  startHttpServer?: typeof startHttpServer;
}): Promise<void> {
  const config = loadConfig(options?.env ?? process.env);
  const logger = createLogger(config.logLevel ?? 'INFO', config.logFile);
  const db = openDatabase(config.dbPath);
  const runHttp = options?.startHttpServer ?? startHttpServer;

  logger.info('timeline mcp starting', { dbPath: config.dbPath, jsonPath: config.jsonPath });

  ensureSchema(db);

  if (isIndexStale(db, config, logger)) {
    rebuildTimelineIndex(db, config, logger);
  }

  const aliases = loadAliases(config);

  logger.info('timeline mcp ready');

  await runHttp({ config, db, aliases, logger });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startRuntime();
}
