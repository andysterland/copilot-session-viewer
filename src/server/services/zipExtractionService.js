const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function resolveWorkerPath() {
  const candidates = [
    path.join(__dirname, '..', 'workers', 'zipExtractorWorker.js'),
    path.join(__dirname, 'zipExtractorWorker.js')
  ];
  const workerPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!workerPath) {
    throw new Error('ZIP extraction worker is missing from this installation');
  }
  return workerPath;
}

class ZipExtractionService {
  constructor(options = {}) {
    this.Worker = options.Worker || Worker;
    this.workerPath = options.workerPath || resolveWorkerPath();
    this.timeoutMs = options.timeoutMs || 120000;
  }

  _run(workerData) {
    return new Promise((resolve, reject) => {
      const worker = new this.Worker(this.workerPath, { workerData });
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(result);
      };
      const timeout = setTimeout(() => {
        worker.terminate().catch(() => {});
        finish(new Error('ZIP extraction timed out'));
      }, this.timeoutMs);
      worker.once('message', message => {
        if (message.ok) {
          finish(null, message.result);
          return;
        }
        const error = new Error(message.error?.message || 'ZIP extraction failed');
        if (message.error?.stack) error.stack = message.error.stack;
        finish(error);
      });
      worker.once('error', error => {
        finish(new Error('ZIP extraction worker failed', { cause: error }));
      });
      worker.once('exit', code => {
        if (code !== 0) finish(new Error(`ZIP extraction worker exited with code ${code}`));
      });
    });
  }

  validate(zipPath) {
    return this._run({ operation: 'validate', zipPath });
  }

  extract(zipPath, extractDir) {
    return this._run({ operation: 'extract', zipPath, extractDir });
  }
}

module.exports = {
  ZipExtractionService,
  resolveWorkerPath
};
