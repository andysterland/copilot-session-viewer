const crypto = require('crypto');

const CORRELATION_HEADER = 'x-correlation-id';

function isCorrelationId(value) {
  return typeof value === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

/**
 * Adds a bounded correlation identifier and optional structured request logging.
 * @param {{ logger?: object }} options middleware options
 * @returns {Function} Express middleware
 */
function requestContext(options = {}) {
  return (req, res, next) => {
    const suppliedId = req.get(CORRELATION_HEADER);
    const correlationId = isCorrelationId(suppliedId)
      ? suppliedId
      : crypto.randomUUID();
    const startedAt = Date.now();

    req.correlationId = correlationId;
    req.logger = options.logger || null;
    res.setHeader('X-Correlation-ID', correlationId);
    if (options.includeErrorId) {
      const sendJson = res.json.bind(res);
      res.json = body => {
        if (res.statusCode >= 400
          && body
          && typeof body === 'object'
          && !Array.isArray(body)
          && !body.correlationId) {
          body = { ...body, correlationId };
        }
        return sendJson(body);
      };
    }

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      if (req.path.startsWith('/api/') && req.logger?.info) {
        req.logger.info('http.request.completed', {
          correlationId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs
        });
      }
    });

    next();
  };
}

module.exports = {
  CORRELATION_HEADER,
  isCorrelationId,
  requestContext
};
