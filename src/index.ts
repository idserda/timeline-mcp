import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { isIndexStale } from './db/freshness.js';
import { ensureSchema } from './db/schema.js';
import { startHttpServer } from './http.js';
import { startStdioServer } from './stdio.js';
import { rebuildTimelineIndex } from './import/importTimeline.js';
import { createLogger } from './log.js';
import { loadAliases } from './query/aliases.js';

export async function startRuntime(options?: {
  env?: NodeJS.ProcessEnv;
  startHttpServer?: typeof startHttpServer;
  startStdioServer?: typeof startStdioServer;
}): Promise<void> {
  const config = loadConfig(options?.env ?? process.env);
  const logger = createLogger(config.logLevel ?? 'INFO', config.logFile);
  const db = openDatabase(config.dbPath);

  logger.info('timeline mcp starting', { dbPath: config.dbPath, jsonPath: config.jsonPath, transport: config.transport });

  ensureSchema(db);

  if (isIndexStale(db, config, logger)) {
    rebuildTimelineIndex(db, config, logger);
  }

  const aliases = loadAliases(config);

  logger.info('timeline mcp ready');

  if (config.transport === 'stdio') {
    await (options?.startStdioServer ?? startStdioServer)({ config, db, aliases, logger });
    return;
  }

  await (options?.startHttpServer ?? startHttpServer)({ config, db, aliases, logger });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startRuntime();
}
