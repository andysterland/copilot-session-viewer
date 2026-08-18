/* eslint-disable vue/one-component-per-file */
const express = require('express');
const request = require('supertest');
const createApp = require('../../../src/server/app');
const { startServer } = require('../../../src/server/lifecycle');
const { STARTUP_TOKEN_HEADER } = require('../../../src/server/middleware/desktopSecurity');

function appOptions() {
  return {
    clientDirectory: require('path').join(__dirname, '..', 'fixtures', 'client'),
    sessionService: {
      sessionRepository: { sources: [] }
    },
    insightService: {},
    tagService: {},
    dirRegistryService: {}
  };
}

describe('embedded server lifecycle and security', () => {
  it('selects a random loopback port and closes cleanly', async () => {
    const app = express();
    app.get('/health', (_req, res) => res.json({ ok: true }));
    const handle = await startServer({ app, host: '127.0.0.1', port: 0 });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
    await expect(fetch(`${handle.url}/health`).then(response => response.json()))
      .resolves.toEqual({ ok: true });
    await handle.close();
    expect(handle.server.listening).toBe(false);
  });

  it('requires startup authentication and CSRF protection for desktop APIs', async () => {
    const tokens = {
      startupToken: 'startup-token',
      sessionToken: 'session-token',
      csrfToken: 'csrf-token'
    };
    const app = createApp({ ...appOptions(), desktopSecurity: tokens });

    await request(app).get('/api/sources').expect(401);
    const exchange = await request(app)
      .get('/desktop-auth')
      .set(STARTUP_TOKEN_HEADER, 'startup-token')
      .expect(303);
    const cookies = exchange.headers['set-cookie'].map(cookie => cookie.split(';')[0]);

    await request(app)
      .post('/api/dirs')
      .set('Cookie', cookies)
      .set('Host', '127.0.0.1:4141')
      .expect(403);

    await request(app)
      .post('/api/dirs')
      .set('Cookie', cookies)
      .set('Host', '127.0.0.1:4141')
      .set('Origin', 'http://127.0.0.1:4141')
      .set('X-CSRF-Token', 'csrf-token')
      .send({ path: 'missing' })
      .expect(400);

    await request(app)
      .get('/desktop-auth')
      .set(STARTUP_TOKEN_HEADER, 'startup-token')
      .expect(401);

    await request(app)
      .get('/desktop-auth?token=startup-token')
      .expect(401);
  });

  it('fails explicitly when a packaged client directory is missing', () => {
    expect(() => createApp({
      ...appOptions(),
      clientDirectory: require('path').join(__dirname, 'does-not-exist')
    })).toThrow('Required application asset is missing');
  });
});
