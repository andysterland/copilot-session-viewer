const fs = require('fs');
const path = require('path');
const {
  ConsoleFallbackLogger,
  StructuredLogger,
  initializeLogger,
  redact
} = require('../../../electron/logger');

describe('structured desktop logging', () => {
  const root = path.join(__dirname, '..', '..', '.artifacts', 'logs');

  beforeEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('redacts secrets, cookies, prompts, and URL tokens', () => {
    expect(redact({
      token: 'secret-token',
      prompt: 'private prompt',
      sessionId: '11111111-1111-4111-8111-111111111111',
      filePath: 'C:\\Users\\person\\sessions\\private.jsonl',
      userInput: 'private response',
      message: 'request?token=secret'
    })).toEqual({
      token: '[REDACTED]',
      prompt: '[REDACTED]',
      sessionId: '[REDACTED]',
      filePath: '[REDACTED]',
      userInput: '[REDACTED]',
      message: 'request[REDACTED]'
    });
  });

  it('removes identifiers and paths from unstructured event strings', () => {
    const value = redact(
      'session 11111111-1111-4111-8111-111111111111 at C:\\private\\session\\events.jsonl'
    );
    expect(value).not.toContain('11111111');
    expect(value).not.toContain('C:\\private');
  });

  it('preserves explicit correlation IDs without preserving session IDs', () => {
    expect(redact({
      correlationId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222'
    })).toEqual({
      correlationId: '11111111-1111-4111-8111-111111111111',
      sessionId: '[REDACTED]'
    });
  });

  it('writes structured records and rotates bounded files', async () => {
    const logger = new StructuredLogger({
      directory: root,
      component: 'test',
      version: '1.0.0',
      maxBytes: 250,
      retainedFiles: 2
    });
    await logger.initialize();
    logger.info('first', { correlationId: 'correlation-1', content: 'private' });
    logger.info('second', { message: 'x'.repeat(300) });
    logger.info('third', { message: 'y'.repeat(300) });
    await logger.flush();

    const active = await fs.promises.readFile(path.join(root, 'desktop.log'), 'utf8');
    expect(active).toContain('"event":"third"');
    expect(active).not.toContain('private');
    expect(await fs.promises.readdir(root)).toEqual(expect.arrayContaining([
      'desktop.log',
      'desktop.log.1'
    ]));
  });

  it('falls back without aborting startup when file logging cannot initialize', async () => {
    const mkdirSpy = jest.spyOn(fs.promises, 'mkdir')
      .mockRejectedValueOnce(new Error('logs unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const logger = await initializeLogger({
      directory: root,
      component: 'test',
      version: '1.0.0'
    });

    expect(logger).toBeInstanceOf(ConsoleFallbackLogger);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('logging.initialization-failed'));
    await expect(logger.flush()).resolves.toBeUndefined();
    mkdirSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
