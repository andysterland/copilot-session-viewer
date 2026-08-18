/**
 * Process Manager - Track and asynchronously clean up spawned process trees.
 */

const path = require('path');
const { spawn } = require('child_process');

class ProcessManager {
  constructor(options = {}) {
    this.activeProcesses = new Set();
    this.isShuttingDown = false;
    this.cleanupPromise = null;
    this.platform = options.platform || process.platform;
    this.spawn = options.spawn || spawn;
    this.killProcessGroup = options.killProcessGroup || process.kill.bind(process);
    this.gracePeriodMs = options.gracePeriodMs ?? 1500;
    this.forcePeriodMs = options.forcePeriodMs ?? 1000;
    if (options.signalHandlers !== false
      && process.env.PROCESS_MANAGER_DISABLE_SIGNAL_HANDLERS !== 'true'
      && process.env.NODE_ENV !== 'test') {
      this._setupCleanupHandlers();
    }
  }

  /**
   * Register a new process for tracking.
   * @param {import('child_process').ChildProcess} childProcess spawned process
   * @param {Object} metadata process name and process-group information
   * @returns {Object} tracked process information
   */
  register(childProcess, metadata = {}) {
    const processInfo = { process: childProcess, metadata, startTime: Date.now() };
    this.activeProcesses.add(processInfo);

    const onFinished = () => {
      childProcess.removeListener('exit', onFinished);
      childProcess.removeListener('close', onFinished);
      this.activeProcesses.delete(processInfo);
      const duration = Date.now() - processInfo.startTime;
      console.log(`🔄 Process exited (${metadata.name || 'unknown'}): ${duration}ms`);
    };
    childProcess.once('exit', onFinished);
    childProcess.once('close', onFinished);

    return processInfo;
  }

  _isRunning(childProcess) {
    return childProcess
      && (childProcess.exitCode === null || childProcess.exitCode === undefined)
      && (childProcess.signalCode === null || childProcess.signalCode === undefined);
  }

  _waitForExit(childProcess, timeoutMs) {
    if (!this._isRunning(childProcess)) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      const finish = exited => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        childProcess.removeListener('exit', onExit);
        childProcess.removeListener('close', onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(!this._isRunning(childProcess)), timeoutMs);
      childProcess.once('exit', onExit);
      childProcess.once('close', onExit);
    });
  }

  _runTaskkill(pid, force) {
    return new Promise(resolve => {
      const command = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'taskkill.exe')
        : 'taskkill.exe';
      const args = ['/PID', String(pid), '/T'];
      if (force) args.push('/F');
      let killer;
      try {
        killer = this.spawn(command, args, {
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        resolve(false);
        return;
      }
      killer.once('error', () => resolve(false));
      killer.once('close', code => resolve(code === 0 || code === 128));
    });
  }

  async _signalProcess(processInfo, force) {
    const { process: childProcess, metadata } = processInfo;
    if (!this._isRunning(childProcess)) return;
    const signal = force ? 'SIGKILL' : 'SIGTERM';

    try {
      if (this.platform === 'win32' && Number.isInteger(childProcess.pid)) {
        const taskkillSucceeded = await this._runTaskkill(childProcess.pid, force);
        if (!taskkillSucceeded && this._isRunning(childProcess)) {
          childProcess.kill(signal);
        }
      } else if (metadata.processGroup && Number.isInteger(childProcess.pid)) {
        this.killProcessGroup(-childProcess.pid, signal);
      } else {
        childProcess.kill(signal);
      }
    } catch (error) {
      console.error(`  ✗ Failed to stop ${metadata.name || childProcess.pid}:`, error.message);
    }
  }

  /**
   * Gracefully terminate all tracked process trees, then escalate remaining processes.
   * @param {{gracePeriodMs?: number, forcePeriodMs?: number}} options timeouts
   * @returns {Promise<{requested: number, remaining: number}>} cleanup result
   */
  async killAll(options = {}) {
    if (this.cleanupPromise) return this.cleanupPromise;
    const tracked = [...this.activeProcesses];
    const gracePeriodMs = options.gracePeriodMs ?? this.gracePeriodMs;
    const forcePeriodMs = options.forcePeriodMs ?? this.forcePeriodMs;

    this.cleanupPromise = (async () => {
      console.log(`🛑 Stopping ${tracked.length} active processes...`);
      await Promise.all(tracked.map(processInfo => this._signalProcess(processInfo, false)));
      await Promise.all(tracked.map(({ process: childProcess }) => (
        this._waitForExit(childProcess, gracePeriodMs)
      )));

      const survivors = tracked.filter(({ process: childProcess }) => this._isRunning(childProcess));
      if (survivors.length > 0) {
        console.warn(`⚠️  Force stopping ${survivors.length} process(es)...`);
        await Promise.all(survivors.map(processInfo => this._signalProcess(processInfo, true)));
        await Promise.all(survivors.map(({ process: childProcess }) => (
          this._waitForExit(childProcess, forcePeriodMs)
        )));
      }

      const remaining = tracked.filter(({ process: childProcess }) => this._isRunning(childProcess));
      for (const processInfo of tracked) {
        if (!remaining.includes(processInfo)) this.activeProcesses.delete(processInfo);
      }
      return { requested: tracked.length, remaining: remaining.length };
    })();

    try {
      return await this.cleanupPromise;
    } finally {
      this.cleanupPromise = null;
    }
  }

  getActiveCount() {
    return this.activeProcesses.size;
  }

  _setupCleanupHandlers() {
    const cleanup = async (signal, exitCode = 0) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      console.log(`\n📛 Received ${signal}, shutting down gracefully...`);
      await this.killAll();
      process.exit(exitCode);
    };

    process.on('SIGTERM', () => {
      cleanup('SIGTERM', 0).catch(error => {
        console.error('Process cleanup failed:', error);
        process.exit(1);
      });
    });
    process.on('SIGINT', () => {
      cleanup('SIGINT', 0).catch(error => {
        console.error('Process cleanup failed:', error);
        process.exit(1);
      });
    });
    process.on('uncaughtException', err => {
      console.error('💥 Uncaught exception:', err);
      cleanup('uncaughtException', 1).catch(() => process.exit(1));
    });
    process.on('unhandledRejection', reason => {
      console.error('💥 Unhandled rejection:', reason);
      cleanup('unhandledRejection', 1).catch(() => process.exit(1));
    });
  }
}

const PROCESS_MANAGER_SINGLETON_KEY = '__copilotSessionViewerProcessManager';

if (!globalThis[PROCESS_MANAGER_SINGLETON_KEY]) {
  globalThis[PROCESS_MANAGER_SINGLETON_KEY] = new ProcessManager();
}

module.exports = globalThis[PROCESS_MANAGER_SINGLETON_KEY];
module.exports.ProcessManager = ProcessManager;
