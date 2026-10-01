import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

describe('startRuntime', () => {
  it('builds the index and starts the HTTP server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-runtime-http-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, JSON.stringify({ semanticSegments: [] }));

    const startHttpServer = vi.fn().mockResolvedValue({ close: vi.fn(), host: '0.0.0.0', port: 3000 });
    const { startRuntime } = await import('../src/index.js');

    await startRuntime({
      env: {
        TIMELINE_JSON_PATH: jsonPath,
        TIMELINE_DB_PATH: dbPath,
        TIMELINE_TRANSPORT: 'http'
      },
      startHttpServer
    });

    expect(startHttpServer).toHaveBeenCalledTimes(1);
  });

  it('starts the stdio server by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timeline-runtime-stdio-'));
    const jsonPath = join(dir, 'timeline.json');
    const dbPath = join(dir, 'timeline.db');

    writeFileSync(jsonPath, JSON.stringify({ semanticSegments: [] }));

    const startHttpServer = vi.fn();
    const startStdioServer = vi.fn().mockResolvedValue({ close: vi.fn() });
    const { startRuntime } = await import('../src/index.js');

    await startRuntime({
      env: {
        TIMELINE_JSON_PATH: jsonPath,
        TIMELINE_DB_PATH: dbPath
      },
      startHttpServer,
      startStdioServer
    });

    expect(startStdioServer).toHaveBeenCalledTimes(1);
    expect(startHttpServer).not.toHaveBeenCalled();
  });
});
