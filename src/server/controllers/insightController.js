const InsightService = require('../services/insightService');
const { isValidSessionId } = require('../utils/helpers');

class InsightController {
  constructor(insightService = null, sessionService = null) {
    if (insightService) {
      this.insightService = insightService;
    } else {
      this.insightService = new InsightService();
    }

    if (sessionService) {
      this.sessionService = sessionService;
    } else {
      const SessionService = require('../services/sessionService');
      this.sessionService = new SessionService();
    }
  }

  // Helper to get sessionId from either new or legacy param
  _getSessionId(req) {
    return req.params.sessionId || req.params.id;
  }

  _getGenerateInsightErrorResponse(err) {
    if (err instanceof Error) {
      if (err.message === 'Events file not found') {
        return { status: 400, body: { error: err.message } };
      }

      if (err.message === 'Failed to acquire lock for insight generation') {
        return { status: 503, body: { error: err.message } };
      }

      if (err.message.includes('CLI was not found')
        || err.message.startsWith('Configured ')) {
        return { status: 503, body: { error: err.message } };
      }

    }

    return { status: 500, body: { error: 'Error generating insight' } };
  }

  // Generate or get insight
  async generateInsight(req, res) {
    try {
      const sessionId = this._getSessionId(req);
      const forceRegenerate = req.body?.force === true;

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.directory) {
        return res.status(400).json({ error: 'Session directory not available' });
      }

      const startTime = Date.now();
      req.logger?.info?.('insight.started', {
        correlationId: req.correlationId,
        source: session.source || 'unknown'
      });
      const result = await this.insightService.generateInsight(
        session.id,
        session.directory,
        session.source,
        forceRegenerate,
        { correlationId: req.correlationId }
      );
      const durationMs = Date.now() - startTime;

      req.logger?.info?.('insight.request-completed', {
        correlationId: req.correlationId,
        source: session.source || 'unknown',
        status: result.status,
        durationMs
      });

      res.json(result);
    } catch (err) {
      console.error('Error generating insight:', err);

      req.logger?.error?.('insight.request-failed', {
        correlationId: req.correlationId,
        error: err
      });

      const errorResponse = this._getGenerateInsightErrorResponse(err);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  // Get insight status
  async getInsightStatus(req, res) {
    try {
      const sessionId = this._getSessionId(req);

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.directory) {
        return res.status(400).json({ error: 'Session directory not available' });
      }

      const result = await this.insightService.getInsightStatus(session.id, session.directory, session.source);

      res.json(result);
    } catch (err) {
      console.error('Error getting insight status:', err);
      res.status(500).json({ error: 'Error getting insight status' });
    }
  }

  // Delete insight
  async deleteInsight(req, res) {
    try {
      const sessionId = this._getSessionId(req);

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.directory) {
        return res.status(400).json({ error: 'Session directory not available' });
      }

      const result = await this.insightService.deleteInsight(session.id, session.directory, session.source);

      res.json(result);
    } catch (err) {
      console.error('Error deleting insight:', err);
      res.status(500).json({ error: 'Error deleting insight' });
    }
  }

}

module.exports = InsightController;
