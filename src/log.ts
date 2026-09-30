import { appendFileSync } from 'node:fs';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const order: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

export type Logger = {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

function writeLine(line: string, filePath?: string): void {
  console.error(line);

  if (filePath) {
    appendFileSync(filePath, `${line}\n`);
  }
}

export function createLogger(level: LogLevel = 'INFO', filePath?: string): Logger {
  const enabledAt = order[level];

  function log(messageLevel: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (order[messageLevel] < enabledAt) {
      return;
    }

    const payload = data ? ` ${JSON.stringify(data)}` : '';
    writeLine(`[${messageLevel}] ${message}${payload}`, filePath);
  }

  return {
    debug: (message, data) => log('DEBUG', message, data),
    info: (message, data) => log('INFO', message, data),
    warn: (message, data) => log('WARN', message, data),
    error: (message, data) => log('ERROR', message, data)
  };
}
