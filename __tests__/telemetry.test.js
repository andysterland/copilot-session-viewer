const {
  createSafeException,
  sanitizeRequestName,
  sanitizeRequestUrl,
  sanitizeTelemetryEnvelope,
  sanitizeTelemetryProperties
} = require('../src/server/telemetry');

describe('telemetry sanitization', () => {
  it('drops query strings, hostnames, and session identifiers from request telemetry', () => {
    expect(sanitizeRequestUrl(
      'http://workstation.local:3838/api/copilot/sessions/private-session/events?token=secret'
    )).toBe('http://localhost/api/copilot/sessions/{sessionId}/events');
    expect(sanitizeRequestName(
      'GET /api/copilot/sessions/private-session/events?offset=50'
    )).toBe('GET /api/copilot/sessions/{sessionId}/events');
  });

  it('removes sensitive custom properties and machine identity tags', () => {
    const envelope = {
      tags: {
        'ai.cloud.roleInstance': 'private-hostname',
        'ai.device.machineName': 'private-hostname',
        'ai.operation.name': 'GET /api/claude/sessions/secret-id?token=secret'
      },
      data: {
        baseType: 'RequestData',
        baseData: {
          name: 'GET /api/claude/sessions/secret-id',
          url: 'http://private-host/api/claude/sessions/secret-id?key=value',
          properties: {
            sessionId: 'secret-id',
            source: 'claude'
          }
        }
      }
    };

    expect(sanitizeTelemetryEnvelope(envelope, '1.2.3')).toBe(true);
    expect(envelope.tags).toEqual({
      'ai.operation.name': 'GET /api/claude/sessions/{sessionId}'
    });
    expect(envelope.data.baseData).toEqual({
      name: 'GET /api/claude/sessions/{sessionId}',
      url: 'http://localhost/api/claude/sessions/{sessionId}',
      properties: {
        source: 'claude',
        appVersion: '1.2.3'
      }
    });
    expect(sanitizeTelemetryProperties({
      prompt: 'private',
      executablePath: 'C:\\private\\cli.exe',
      source: 'copilot'
    })).toEqual({ source: 'copilot' });
  });

  it('reports exception categories without original messages, stacks, or paths', () => {
    const original = new TypeError(
      'Failed for session private-session at C:\\Users\\private\\events.jsonl?token=secret'
    );
    const safe = createSafeException(original);

    expect(safe.name).toBe('TypeError');
    expect(safe.message).toBe('Operational error');
    expect(safe.stack).toBeUndefined();
  });
});
