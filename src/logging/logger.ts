import pino from 'pino';

let logger: pino.Logger;

export function initLogger(level: string = 'info'): pino.Logger {
  logger = pino({
    level,
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
  });
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    return initLogger();
  }
  return logger;
}
