const crypto = require('crypto');

const AUTH_COOKIE = 'csv-desktop-auth';
const CSRF_COOKIE = 'csv-desktop-csrf';
const STARTUP_TOKEN_HEADER = 'x-csv-desktop-startup-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator === -1) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function tokensMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getExpectedOrigin(req) {
  return `http://${req.headers.host}`;
}

/**
 * Adds one-time startup authentication and CSRF protection to an embedded server.
 * @param {{ startupToken: string, sessionToken: string, csrfToken: string }} security token set
 * @returns {Function[]} Express middleware installed before API routes
 */
function createDesktopSecurityMiddleware(security) {
  if (!security?.startupToken || !security?.sessionToken || !security?.csrfToken) {
    throw new Error('Desktop security requires startup, session, and CSRF tokens');
  }

  let startupTokenAvailable = true;

  const exchangeStartupToken = (req, res) => {
    const suppliedToken = req.get(STARTUP_TOKEN_HEADER) || '';
    if (!startupTokenAvailable || !tokensMatch(suppliedToken, security.startupToken)) {
      return res.status(401).type('text/plain').send('Desktop authentication failed');
    }

    startupTokenAvailable = false;
    res.setHeader('Cache-Control', 'no-store');
    res.append('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(security.sessionToken)}; HttpOnly; SameSite=Strict; Path=/`);
    res.append('Set-Cookie', `${CSRF_COOKIE}=${encodeURIComponent(security.csrfToken)}; SameSite=Strict; Path=/`);
    return res.redirect(303, '/');
  };

  const protectApi = (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();

    const cookies = parseCookies(req.headers.cookie);
    if (!tokensMatch(cookies[AUTH_COOKIE], security.sessionToken)) {
      return res.status(401).json({
        error: 'Desktop session authentication required',
        correlationId: req.correlationId
      });
    }

    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    const csrfHeader = req.get('x-csrf-token');
    const expectedOrigin = getExpectedOrigin(req);
    if (origin !== expectedOrigin
      || !tokensMatch(cookies[CSRF_COOKIE], security.csrfToken)
      || !tokensMatch(csrfHeader, security.csrfToken)) {
      return res.status(403).json({
        error: 'Invalid request origin or CSRF token',
        correlationId: req.correlationId
      });
    }

    return next();
  };

  return { exchangeStartupToken, protectApi };
}

module.exports = {
  AUTH_COOKIE,
  CSRF_COOKIE,
  STARTUP_TOKEN_HEADER,
  createDesktopSecurityMiddleware,
  parseCookies,
  tokensMatch
};
