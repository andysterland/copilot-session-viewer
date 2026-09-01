const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const { isValidSessionId } = require('../utils/helpers');
const config = require('../config');
const { registry } = require('../adapters');
const { ZipExtractionService } = require('../services/zipExtractionService');

class UploadController {
  constructor(options = {}) {
    this.SESSION_DIR = process.env.SESSION_DIR || path.join(os.homedir(), '.copilot', 'session-state');
    this.uploadDir = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'copilot-session-uploads');

    // Multi-format session directories
    this.SESSION_DIRS = {
      copilot: this.SESSION_DIR,
      claude: path.join(os.homedir(), '.claude', 'projects'),
      'pi-mono': path.join(os.homedir(), '.pi', 'agent', 'sessions')
    };
    this.zipExtractionService = options.zipExtractionService || new ZipExtractionService();

    // Don't create uploadDir here - multer's DiskStorage will handle it
    // This avoids EEXIST errors when multiple tests run in parallel
    this.upload = this.createMulterInstance();
  }

  createMulterInstance() {
    return multer({
      dest: this.uploadDir,
      limits: { fileSize: config.MAX_UPLOAD_SIZE },
      fileFilter: (req, file, cb) => {
        // Check both file extension and MIME type
        const isZipExtension = file.originalname.toLowerCase().endsWith('.zip');
        const isZipMime = file.mimetype === 'application/zip' ||
                          file.mimetype === 'application/x-zip-compressed';

        if (!isZipExtension || !isZipMime) {
          return cb(new Error('Only .zip files are allowed'));
        }
        cb(null, true);
      }
    });
  }

  // Import session from zip (with validation)
  async importSession(req, res) {
    let extractDir = null;
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const zipPath = req.file.path;
      extractDir = path.join(this.uploadDir, `extract-${crypto.randomUUID()}`);
      const uploadedFileSize = (await fs.promises.stat(zipPath)).size;
      req.logger?.info?.('import.started', {
        correlationId: req.correlationId,
        compressedBytes: uploadedFileSize
      });

      await fs.promises.mkdir(extractDir, { recursive: true });
      await this._extractZipArchive(zipPath, extractDir);
      await fs.promises.unlink(zipPath).catch(() => {});

      const result = await this._importExtractedSession(extractDir, req);
      await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});

      if (!result.success) {
        const body = { error: result.error };
        if (result.code) body.code = result.code;
        if (result.candidates) body.candidates = result.candidates;
        return res.status(result.statusCode || 500).json(body);
      }

      req.logger?.info?.('import.completed', {
        correlationId: req.correlationId,
        format: result.format,
        compressedBytes: uploadedFileSize
      });
      const body = { success: true, sessionId: result.sessionId, format: result.format };
      if (result.project) body.project = result.project;
      return res.json(body);
    } catch (err) {
      console.error('Error processing upload:', err);
      req.logger?.error?.('import.failed', {
        correlationId: req.correlationId,
        error: err
      });
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      if (extractDir) await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
      // Surface known validation errors as 400
      if (err.message?.match(/Compressed file too large|Uncompressed size too large|Too many files|Directory nesting too deep|Invalid archive path|Invalid archive entry size|Symbolic links|Failed to read zip/)) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Error processing upload' });
    }
  }

  // Multer middleware accessor
  getUploadMiddleware() {
    // Accept both 'zipFile' (canonical) and 'sessionZip' (legacy frontend)
    const fieldNames = ['zipFile', 'sessionZip'];
    const middleware = this.upload.fields(fieldNames.map(name => ({ name, maxCount: 1 })));
    return (req, res, next) => {
      middleware(req, res, (err) => {
        if (err) return next(err);
        req.file = fieldNames.map(n => req.files?.[n]?.[0]).find(Boolean) || null;
        return next();
      });
    };
  }

  /**
   * Detect format via adapter registry. Returns backward-compat shape for _detectFormat,
   * plus structured result via _detectImportCandidates.
   */
  async _detectFormat(extractDir) {
    const det = await this._detectImportCandidates(extractDir);
    if (det.status !== 'matched') return null;
    return { format: det.match.source, extractDir, ...det.match };
  }

  async _detectImportCandidates(extractDir) {
    try {
      const entries = await fs.promises.readdir(extractDir);
      if (entries.length === 0) {
        return { status: 'unsupported-format', matches: [], candidates: [], error: 'Empty zip file' };
      }
      // Path-traversal guard
      if (entries.some(e => e.includes('..') || path.isAbsolute(e))) {
        return { status: 'invalid-structure', matches: [], candidates: [], error: 'Invalid session directory name in zip file' };
      }
      const candidates = await registry.detectImportCandidates(extractDir);
      const matches = candidates.filter(c => c.matched);
      if (matches.length === 0) return { status: 'unsupported-format', matches: [], candidates, error: 'Unsupported session zip format' };
      if (matches.length > 1) return { status: 'ambiguous', matches, candidates, error: 'Ambiguous session zip format' };
      return { status: 'matched', match: matches[0], matches, candidates };
    } catch (err) {
      console.error('Error detecting format:', err);
      return { status: 'error', matches: [], candidates: [], error: 'Error detecting format' };
    }
  }

  async _importCopilotSession(formatInfo, extractDir) {
    return registry.get('copilot').importDetectedSession(formatInfo, { extractDir, req: { query: {} }, targetDir: this.SESSION_DIRS.copilot });
  }
  async _importClaudeSession(formatInfo, extractDir, req) {
    return registry.get('claude').importDetectedSession(formatInfo, { extractDir, req, targetDir: this.SESSION_DIRS.claude });
  }
  async _importPiMonoSession(formatInfo, extractDir, req) {
    return registry.get('pi-mono').importDetectedSession(formatInfo, { extractDir, req, targetDir: this.SESSION_DIRS['pi-mono'] });
  }

  async _importByFormat(formatInfo, extractDir, req) {
    if (!isValidSessionId(formatInfo.sessionId)) {
      return { success: false, error: 'Invalid session ID', statusCode: 400 };
    }
    const adapter = registry.get(formatInfo.format || formatInfo.source);
    if (!adapter) {
      return { success: false, error: `Unsupported format: ${formatInfo.format || formatInfo.source}`, statusCode: 400, code: 'unsupported-format' };
    }
    return adapter.importDetectedSession(formatInfo, { extractDir, req, targetDir: this.SESSION_DIRS[formatInfo.format || formatInfo.source] });
  }

  async _validateZipArchive(zipPath) {
    return this.zipExtractionService.validate(zipPath);
  }

  async _extractZipArchive(zipPath, extractDir) {
    return this.zipExtractionService.extract(zipPath, extractDir);
  }

  async _importExtractedSession(extractDir, req) {
    const det = await this._detectImportCandidates(extractDir);
    if (det.status === 'error') return { success: false, statusCode: 500, error: 'Error importing session' };
    if (det.status === 'invalid-structure') return { success: false, statusCode: 400, error: det.error };
    if (det.status === 'unsupported-format') {
      return { success: false, statusCode: det.error === 'Empty zip file' ? 400 : 415, error: det.error, code: 'unsupported-format', candidates: det.candidates };
    }
    if (det.status === 'ambiguous') {
      return { success: false, statusCode: 400, error: det.error, code: 'ambiguous-format', candidates: det.matches };
    }
    return this._importByFormat(det.match, extractDir, req);
  }

}

module.exports = UploadController;