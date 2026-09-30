import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/schema.js';
import { startHttpServer } from '../src/http.js';

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe('startHttpServer', () => {
  it('serves health endpoint', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);

    const server = await startHttpServer({
      config: {
        jsonPath: '/tmp/Tijdlijn.json',
        dbPath: ':memory:',
        httpHost: '127.0.0.1',
        httpPort: 0
      },
      db,
      aliases: { placeIds: {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} }
    } as any);

    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('responds to MCP initialize on /mcp', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);

    const server = await startHttpServer({
      config: {
        jsonPath: '/tmp/Tijdlijn.json',
        dbPath: ':memory:',
        httpHost: '127.0.0.1',
        httpPort: 0
      },
      db,
      aliases: { placeIds: {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} }
    } as any);

    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'vitest', version: '1.0.0' }
        }
      })
    });

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('mcp-session-id')).toBeTruthy();
    expect(body).toContain('event: message');
    expect(body).toContain('"jsonrpc":"2.0"');
    expect(body).toContain('"id":1');
    expect(body).toContain('"name":"timeline-mcp"');
  });
});
