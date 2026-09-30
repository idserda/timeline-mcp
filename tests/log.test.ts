import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log.js';

describe('createLogger', () => {
  it('writes messages at or above configured level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('WARN');

    logger.info('hidden');
    logger.warn('shown');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[WARN] shown');

    spy.mockRestore();
  });

  it('appends to log file when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-log-'));
    const logFile = join(dir, 'timeline.log');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('INFO', logFile);

    logger.info('startup', { server: 'timeline-mcp' });

    expect(readFileSync(logFile, 'utf8')).toContain('[INFO] startup');
    spy.mockRestore();
  });
});
