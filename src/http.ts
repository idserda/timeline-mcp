import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { Logger } from './log.js';
import { buildMcpServer } from './mcp/server.js';
import type { ServerDeps } from './mcp/server.js';

async function readJsonBody(req: AsyncIterable<string | Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startHttpServer(
  deps: ServerDeps & { logger: Logger }
): Promise<{ close(): Promise<void>; host: string; port: number }> {
  const host = deps.config.httpHost ?? '0.0.0.0';
  const requestedPort = deps.config.httpPort ?? 3000;
  const sessions = new Map<string, NodeStreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    if (req.method === 'POST' && req.url === '/mcp') {
      const body = await readJsonBody(req);
      const sessionId = req.headers['mcp-session-id'];

      if (typeof sessionId === 'string') {
        const transport = sessions.get(sessionId);

        if (!transport) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
          return;
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if (body && typeof body === 'object' && !Array.isArray(body) && (body as { method?: unknown }).method === 'initialize') {
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => {
            sessions.set(id, transport);
          }
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await buildMcpServer(deps).connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: Session ID required' }, id: null }));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  deps.logger.info('timeline http listening', { host, port });

  return {
    host,
    port,
    close: async () => {
      await Promise.all(Array.from(sessions.values(), transport => transport.close()));
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
