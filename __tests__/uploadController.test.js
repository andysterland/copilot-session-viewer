const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const AdmZip = require('adm-zip');
const UploadController = require('../src/server/controllers/uploadController');
const {
  inspectEntry,
  openAndValidateArchive
} = require('../src/server/workers/zipExtractorWorker');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function createUploadApp(controller) {
  const app = express();
  app.post('/upload', controller.getUploadMiddleware(), (req, res) => {
    res.json({
      fieldname: req.file?.fieldname,
      filename: req.file?.originalname,
      mimetype: req.file?.mimetype
    });
  });
  app.use((error, _req, res, _next) => {
    res.status(400).json({ error: error.message });
  });
  return app;
}

describe('UploadController', () => {
  const artifactRoot = path.join(__dirname, '.artifacts', 'upload-controller');
  const validSessionId = '11111111-1111-4111-8111-111111111111';
  let controller;

  beforeEach(async () => {
    await fs.promises.rm(artifactRoot, { recursive: true, force: true });
    await fs.promises.mkdir(artifactRoot, { recursive: true });
    process.env.UPLOAD_DIR = path.join(artifactRoot, 'uploads');
    process.env.SESSION_DIR = path.join(artifactRoot, 'sessions');
    controller = new UploadController();
    await fs.promises.mkdir(controller.uploadDir, { recursive: true });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    delete process.env.UPLOAD_DIR;
    delete process.env.SESSION_DIR;
    jest.restoreAllMocks();
    await fs.promises.rm(artifactRoot, { recursive: true, force: true });
  });

  function writeZip(name, entries) {
    const zip = new AdmZip();
    for (const [entryName, data] of entries) {
      zip.addFile(entryName, Buffer.from(data));
    }
    const zipPath = path.join(artifactRoot, name);
    zip.writeZip(zipPath);
    return zipPath;
  }

  async function importZip(zipPath, overrides = {}) {
    const req = {
      file: { path: zipPath, originalname: path.basename(zipPath) },
      query: {},
      logger: { info: jest.fn(), error: jest.fn() },
      correlationId: 'upload-test',
      ...overrides
    };
    const res = createResponse();
    await controller.importSession(req, res);
    return { req, res };
  }

  describe('constructor and initialization', () => {
    it('should initialize with correct directories', () => {
      expect(controller.SESSION_DIR).toBe(process.env.SESSION_DIR);
      expect(controller.uploadDir).toBe(process.env.UPLOAD_DIR);
    });

    it('should create multer and asynchronous ZIP extraction services', () => {
      expect(controller.upload).toBeDefined();
      expect(controller.zipExtractionService).toBeDefined();
      expect(typeof controller.getUploadMiddleware()).toBe('function');
    });
  });

  describe('multipart file filtering', () => {
    it.each([
      ['application/zip', 'session.zip', 'zipFile'],
      ['application/x-zip-compressed', 'session.zip', 'zipFile'],
      ['application/zip', 'session.ZIP', 'zipFile'],
      ['application/zip', 'legacy.zip', 'sessionZip']
    ])('accepts %s uploads named %s in the %s field', async (mimetype, filename, field) => {
      const response = await request(createUploadApp(controller))
        .post('/upload')
        .attach(field, Buffer.from('zip fixture'), { filename, contentType: mimetype })
        .expect(200);

      expect(response.body).toEqual({
        fieldname: field,
        filename,
        mimetype
      });
    });

    it.each([
      ['application/zip', 'session.tar.gz'],
      ['application/pdf', 'session.zip'],
      ['application/x-executable', 'malicious.zip'],
      ['application/zip', 'file.txt']
    ])('rejects %s uploads named %s', async (mimetype, filename) => {
      const response = await request(createUploadApp(controller))
        .post('/upload')
        .attach('zipFile', Buffer.from('not accepted'), { filename, contentType: mimetype })
        .expect(400);

      expect(response.body).toEqual({ error: 'Only .zip files are allowed' });
    });
  });

  describe('asynchronous archive validation and extraction', () => {
    it('extracts through a worker without blocking the server event loop', async () => {
      const zipPath = writeZip('worker.zip', [
        [`${validSessionId}/events.jsonl`, '{"type":"user.message"}\n']
      ]);
      const extractDir = path.join(artifactRoot, 'worker-extract');
      let settled = false;
      const extraction = controller._extractZipArchive(zipPath, extractDir)
        .then(result => {
          settled = true;
          return result;
        });

      await new Promise(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      await expect(extraction).resolves.toEqual(expect.objectContaining({
        entries: 1
      }));
      await expect(fs.promises.readFile(
        path.join(extractDir, validSessionId, 'events.jsonl'),
        'utf8'
      )).resolves.toContain('user.message');
    });

    it('rejects unreadable archives', async () => {
      const zipPath = path.join(artifactRoot, 'invalid.zip');
      await fs.promises.writeFile(zipPath, 'not a zip');
      await expect(controller._validateZipArchive(zipPath))
        .rejects.toThrow('Failed to read zip contents');
    });

    it('rejects compressed uploads larger than the archive limit before parsing', async () => {
      const zipPath = path.join(artifactRoot, 'oversized.zip');
      await fs.promises.writeFile(zipPath, Buffer.alloc(1));
      await fs.promises.truncate(zipPath, (50 * 1024 * 1024) + 1);
      await expect(controller._validateZipArchive(zipPath))
        .rejects.toThrow('Compressed file too large');
    });

    it('rejects archive traversal paths', () => {
      expect(() => inspectEntry({
        entryName: '../outside.txt',
        attr: 0,
        header: { size: 1 }
      })).toThrow('Invalid archive path');
    });

    it('rejects absolute Windows archive paths', () => {
      expect(() => inspectEntry({
        entryName: 'C:/outside.txt',
        attr: 0,
        header: { size: 1 }
      })).toThrow('Invalid archive path');
    });

    it('rejects Windows alternate-data-stream archive paths', () => {
      expect(() => inspectEntry({
        entryName: 'session/events.jsonl:hidden',
        attr: 0,
        header: { size: 1 }
      })).toThrow('Invalid archive path');
    });

    it('rejects symbolic links', () => {
      expect(() => inspectEntry({
        entryName: 'session/link',
        attr: 0xA000 << 16,
        header: { size: 1 }
      })).toThrow('Symbolic links are not allowed');
    });

    it('rejects excessive directory nesting', async () => {
      const zipPath = writeZip('deep.zip', [
        ['one/two/three/four/five/six/file.txt', 'too deep']
      ]);
      await expect(controller._validateZipArchive(zipPath))
        .rejects.toThrow('Directory nesting too deep');
    });

    it('enforces uncompressed-size limits from archive metadata', () => {
      const zipPath = writeZip('large.zip', [['session/events.jsonl', 'large']]);
      expect(() => openAndValidateArchive(zipPath, { maxUncompressedBytes: 1 }))
        .toThrow('Uncompressed size too large');
    });

    it('enforces archive entry-count limits', () => {
      const zipPath = writeZip('many.zip', [
        ['one.txt', '1'],
        ['two.txt', '2']
      ]);
      expect(() => openAndValidateArchive(zipPath, { maxFiles: 1 }))
        .toThrow('Too many files in archive');
    });
  });

  describe('importSession', () => {
    it('should reject a request with no file', async () => {
      const res = createResponse();
      await controller.importSession({ file: null }, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'No file uploaded' });
    });

    it('should successfully import a valid session and clean temporary data', async () => {
      const zipPath = writeZip('session.zip', [
        [`${validSessionId}/events.jsonl`, '{"type":"user.message"}\n']
      ]);
      jest.spyOn(controller, '_importExtractedSession').mockResolvedValue({
        success: true,
        sessionId: validSessionId,
        format: 'copilot'
      });

      const { req, res } = await importZip(zipPath);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        sessionId: validSessionId,
        format: 'copilot'
      });
      expect(req.logger.info).toHaveBeenCalledWith('import.completed', expect.objectContaining({
        correlationId: 'upload-test',
        format: 'copilot'
      }));
      await expect(fs.promises.access(zipPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should reject empty ZIP files', async () => {
      const zipPath = writeZip('empty.zip', []);
      const { res } = await importZip(zipPath);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(expect.objectContaining({ error: 'Empty zip file' }));
    });

    it('should reject unsupported session formats', async () => {
      const zipPath = writeZip('unsupported.zip', [['unknown/readme.txt', 'unknown']]);
      const { res } = await importZip(zipPath);
      expect(res.statusCode).toBe(415);
      expect(res.body).toEqual(expect.objectContaining({
        error: 'Unsupported session zip format',
        code: 'unsupported-format'
      }));
    });

    it('should preserve adapter conflict responses', async () => {
      const zipPath = writeZip('existing.zip', [['session/file.txt', 'fixture']]);
      jest.spyOn(controller, '_importExtractedSession').mockResolvedValue({
        success: false,
        statusCode: 409,
        error: 'Session already exists'
      });
      const { res } = await importZip(zipPath);
      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'Session already exists' });
    });

    it('should surface ambiguous-format details', async () => {
      const zipPath = writeZip('ambiguous.zip', [['session/file.txt', 'fixture']]);
      jest.spyOn(controller, '_importExtractedSession').mockResolvedValue({
        success: false,
        statusCode: 400,
        error: 'Ambiguous session zip format',
        code: 'ambiguous-format',
        candidates: [{ source: 'copilot' }, { source: 'claude' }]
      });
      const { res } = await importZip(zipPath);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(expect.objectContaining({
        code: 'ambiguous-format',
        candidates: expect.any(Array)
      }));
    });

    it('should return validation failures as client errors and remove the upload', async () => {
      const zipPath = path.join(artifactRoot, 'invalid-upload.zip');
      await fs.promises.writeFile(zipPath, 'not a zip');
      const { res } = await importZip(zipPath);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Failed to read zip/);
      await expect(fs.promises.access(zipPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should contain worker failures and clean uploaded files', async () => {
      const zipPath = writeZip('worker-failure.zip', [['session/file.txt', 'fixture']]);
      jest.spyOn(controller.zipExtractionService, 'extract')
        .mockRejectedValue(new Error('worker unavailable'));
      const { req, res } = await importZip(zipPath);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Error processing upload' });
      expect(req.logger.error).toHaveBeenCalledWith('import.failed', expect.any(Object));
      await expect(fs.promises.access(zipPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should ignore cleanup failures after a successful import', async () => {
      const zipPath = writeZip('cleanup.zip', [['session/file.txt', 'fixture']]);
      jest.spyOn(controller.zipExtractionService, 'extract').mockResolvedValue({
        entries: 1,
        extractedBytes: 7
      });
      jest.spyOn(controller, '_importExtractedSession').mockResolvedValue({
        success: true,
        sessionId: validSessionId,
        format: 'copilot'
      });
      jest.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error('unlink failed'));
      jest.spyOn(fs.promises, 'rm').mockRejectedValue(new Error('rm failed'));

      const { res } = await importZip(zipPath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should contain unexpected detection errors', async () => {
      const zipPath = writeZip('detection-error.zip', [['session/file.txt', 'fixture']]);
      jest.spyOn(controller, '_importExtractedSession')
        .mockRejectedValue(new Error('detection failed'));
      const { res } = await importZip(zipPath);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Error processing upload' });
    });
  });

  describe('format dispatch', () => {
    it('rejects invalid detected session IDs', async () => {
      await expect(controller._importByFormat({
        format: 'copilot',
        sessionId: '../invalid'
      }, artifactRoot, { query: {} })).resolves.toEqual({
        success: false,
        error: 'Invalid session ID',
        statusCode: 400
      });
    });

    it('rejects unsupported detected formats', async () => {
      await expect(controller._importByFormat({
        format: 'unknown',
        sessionId: validSessionId
      }, artifactRoot, { query: {} })).resolves.toEqual(expect.objectContaining({
        success: false,
        code: 'unsupported-format',
        statusCode: 400
      }));
    });

    it('should return multer middleware functions for every request', () => {
      expect(typeof controller.getUploadMiddleware()).toBe('function');
      expect(typeof controller.getUploadMiddleware()).toBe('function');
    });
  });
});
