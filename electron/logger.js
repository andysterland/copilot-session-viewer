const fs = require('fs');
const path = require('path');
const os = require('os');

const SENSITIVE_KEY = /(authorization|cookie|secret|token|prompt|content|sessiondata|sessionid|events|password|dialogtext|userinput|filepaths?|directory|destination|backuppath)/i;
const SENSITIVE_VALUE = /(Bearer\s+\S+|[?&](?:token|key|secret)=[^&\s]+)/gi;
const SESSION_IDENTIFIER = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const WINDOWS_PATH = /(?:[a-z]:\\|\\\\)[^\s"',}]*/gi;
const POSIX_PATH = /(^|[\s("'`])\/(?:[^/\s"',}]+\/)+[^/\s"',}]*/g;

function redactString(value) {
  return value
    .replaceAll(os.homedir(), '[REDACTED]')
    .replace(SENSITIVE_VALUE, '[REDACTED]')
    .replace(SESSION_IDENTIFIER, '[REDACTED]')
    .replace(WINDOWS_PATH, '[REDACTED]')
    .replace(POSIX_PATH, (_match, prefix) => `${prefix}[REDACTED]`);
}

function redact(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (key.toLowerCase() === 'correlationid' && typeof value === 'string') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message)
    };
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redact(childValue, childKey)
    ]));
  }
  return value;
}

/**
 * JSON-lines logger with bounded rotation and recursive sensitive-data redaction.
 */
class StructuredLogger {
  constructor(options) {
    this.directory = options.directory;
    this.component = options.component || 'electron-main';
    this.version = options.version || 'unknown';
    this.platform = options.platform || process.platform;
    this.maxBytes = options.maxBytes || 5 * 1024 * 1024;
    this.retainedFiles = options.retainedFiles || 7;
    this.filePath = path.join(this.directory, 'desktop.log');
    this.writeTail = Promise.resolve();
  }

  async initialize() {
    await fs.promises.mkdir(this.directory, { recursive: true });
    await this._rotateIfNeeded();
  }

  debug(event, properties) {
    this._write('debug', event, properties);
  }

  info(event, properties) {
    this._write('info', event, properties);
  }

  warn(event, properties) {
    this._write('warn', event, properties);
  }

  error(event, properties) {
    this._write('error', event, properties);
  }

  _write(level, event, properties = {}) {
    const record = redact({
      timestamp: new Date().toISOString(),
      level,
      process: this.component,
      version: this.version,
      platform: this.platform,
      event,
      ...properties
    });
    const line = `${JSON.stringify(record)}\n`;
    this.writeTail = this.writeTail
      .then(async () => {
        await this._rotateIfNeeded(Buffer.byteLength(line));
        await fs.promises.appendFile(this.filePath, line, 'utf8');
      })
      .catch(error => {
        console.error('Desktop logging failed:', error.message);
      });
  }

  async _rotateIfNeeded(incomingBytes = 0) {
    let size = 0;
    try {
      size = (await fs.promises.stat(this.filePath)).size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (size + incomingBytes <= this.maxBytes) return;

    const oldest = `${this.filePath}.${this.retainedFiles}`;
    await fs.promises.rm(oldest, { force: true });
    for (let index = this.retainedFiles - 1; index >= 1; index--) {
      const source = `${this.filePath}.${index}`;
      const destination = `${this.filePath}.${index + 1}`;
      try {
        await fs.promises.rename(source, destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    try {
      await fs.promises.rename(this.filePath, `${this.filePath}.1`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async flush() {
    await this.writeTail;
  }
}

class ConsoleFallbackLogger {
  constructor(options = {}) {
    this.component = options.component || 'electron-main';
    this.version = options.version || 'unknown';
  }

  _write(level, event, properties = {}) {
    const record = redact({
      level,
      process: this.component,
      version: this.version,
      event,
      ...properties
    });
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](JSON.stringify(record));
  }

  debug(event, properties) {
    this._write('debug', event, properties);
  }

  info(event, properties) {
    this._write('info', event, properties);
  }

  warn(event, properties) {
    this._write('warn', event, properties);
  }

  error(event, properties) {
    this._write('error', event, properties);
  }

  async flush() {}
}

async function initializeLogger(options) {
  const structuredLogger = new StructuredLogger(options);
  try {
    await structuredLogger.initialize();
    return structuredLogger;
  } catch (error) {
    const fallback = new ConsoleFallbackLogger(options);
    fallback.error('logging.initialization-failed', { error });
    return fallback;
  }
}

module.exports = {
  ConsoleFallbackLogger,
  StructuredLogger,
  initializeLogger,
  redact
};
