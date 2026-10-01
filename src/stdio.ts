import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { Logger } from './log.js';
import { buildMcpServer } from './mcp/server.js';
import type { ServerDeps } from './mcp/server.js';

export async function startStdioServer(deps: ServerDeps & { logger: Logger }): Promise<{ close(): Promise<void> }> {
  // stdout carries the MCP protocol; the logger writes to stderr only.
  const handle = serveStdio(() => buildMcpServer(deps), {
    onerror: error => deps.logger.error('timeline stdio error', { error: error.message })
  });

  deps.logger.info('timeline stdio listening');

  return handle;
}
