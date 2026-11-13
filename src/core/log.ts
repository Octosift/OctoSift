/**
 * The application logger. Every message and field passes through the
 * redactor, so a secret that reaches a log call is replaced before output.
 * This is the only module allowed to write to the console.
 */
import type { Redactor } from './secrets/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface LogRecord {
  level: LogLevel;
  message: string;
  fields: LogFields;
  time: string;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  redactor: Redactor;
  sink?: (record: LogRecord) => void;
  now?: () => Date;
}

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LEVEL_ORDER, value);
}

function consoleSink(record: LogRecord): void {
  const fields = Object.keys(record.fields).length > 0 ? ` ${JSON.stringify(record.fields)}` : '';
  const line = `${record.time} ${record.level.toUpperCase()} ${record.message}${fields}`;
  if (record.level === 'error' || record.level === 'warn') console.error(line);
  else console.log(line);
}

export function createLogger(options: LoggerOptions, baseFields: LogFields = {}): Logger {
  const { level, redactor, sink = consoleSink, now = () => new Date() } = options;

  function write(recordLevel: LogLevel, message: string, fields: LogFields = {}) {
    if (LEVEL_ORDER[recordLevel] < LEVEL_ORDER[level]) return;
    sink({
      level: recordLevel,
      message: redactor.redact(message),
      fields: redactor.redactValue({ ...baseFields, ...fields }) as LogFields,
      time: now().toISOString(),
    });
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger(options, { ...baseFields, ...fields }),
  };
}

/** A logger that discards everything; handy as a default in tests. */
export function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}
