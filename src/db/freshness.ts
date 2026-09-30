import { statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { TimelineConfig } from '../config.js';
import type { Logger } from '../log.js';

export function isIndexStale(db: Database.Database, config: TimelineConfig, logger?: Logger): boolean {
  const source = statSync(config.jsonPath);
  const rows = db.prepare('select key, value from metadata').all() as Array<{ key: string; value: string }>;
  const metadata = Object.fromEntries(rows.map(row => [row.key, row.value]));

  if (!metadata.sourceMtimeMs || !metadata.sourceSize) {
    logger?.info('timeline index missing metadata, rebuild required');
    return true;
  }

  const stale = metadata.sourceMtimeMs !== String(source.mtimeMs) || metadata.sourceSize !== String(source.size);

  logger?.info('timeline index freshness checked', { stale, sourcePath: config.jsonPath });

  return stale;
}
