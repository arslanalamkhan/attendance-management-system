import { pino, type Logger } from 'pino';
import { config } from '../config';

export const logger: Logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  ...(config.logPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
