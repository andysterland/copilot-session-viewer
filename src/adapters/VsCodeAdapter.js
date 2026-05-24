const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { fileURLToPath } = require('url');
const BaseSourceAdapter = require('./BaseSourceAdapter');
const Session = require('../models/Session');
const { shouldSkipEntry, getSessionMetadataOptimized } = require('../utils/fileUtils');
const { computeSessionStatus } = require('./adapterUtils');

/**
 * Return candidate VS Code workspace storage paths in preference order.
 * Returns [stable, insiders] — stable is always tried first.
 */
function getVSCodeWorkspaceStorageCandidates() {
  let base;
  switch (os.platform()) {
    case 'win32':
      base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));
      break;
    case 'darwin':
      base = path.join(os.homedir(), 'Library', 'Application Support');
      break;
    case 'linux':
      base = path.join(os.homedir(), '.config');
      break;
    default:
      base = path.join(os.homedir(), '.config');
  }
  return [
    path.join(base, 'Code', 'User', 'workspaceStorage'),
    path.join(base, 'Code - Insiders', 'User', 'workspaceStorage'),
  ];
}

/**
 * VSCode Copilot Chat Source Adapter
 *
 * Reads copilot-agent transcript sessions from VS Code workspaceStorage.
 * Only reads GitHub.copilot-chat/transcripts/*.jsonl (same format as copilot-cli).
 */
class VsCodeAdapter extends BaseSourceAdapter {
  constructor() {
    super();
    this._candidates = null;
  }

  get type() { return 'vscode'; }
  get displayName() { return 'Copilot Chat'; }
  get envVar() { return 'VSCODE_WORKSPACE_STORAGE_DIR'; }
  get hasCustomPipeline() { return true; }

  getDefaultDir() {
    const candidates = this._getCandidates();
    return candidates[0];
  }

  _getCandidates() {
    if (!this._candidates) {
      this._candidates = getVSCodeWorkspaceStorageCandidates();
    }
    return this._candidates;
  }

  /**
   * Override resolveDir to try stable then Insiders.
   */
  async resolveDir() {
    if (this.envVar && process.env[this.envVar]) {
      return process.env[this.envVar];
    }
    const candidates = this._getCandidates();
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch { /* try next */ }
    }
    return null;
  }

  async scanEntries(dir) {
    const entries = await fs.readdir(dir);
    const tasks = entries
      .filter(entry => !shouldSkipEntry(entry))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry);
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return this._scanWorkspaceDir(fullPath);
        }
        return null;
      });

    const results = await Promise.allSettled(tasks);
    return results
      .filter(r => r.status === 'fulfilled' && r.value !== null && r.value !== undefined)
      .map(r => r.value)
      .flat();
  }

  async findById(sessionId, dir) {
    try {
      const hashes = await fs.readdir(dir);
      const candidates = [];

      for (const hash of hashes) {
        const transcriptsDir = path.join(dir, hash, 'GitHub.copilot-chat', 'transcripts');
        try {
          const files = await fs.readdir(transcriptsDir);
          const matchingFile = files.find(f => f === `${sessionId}.jsonl` || f.replace(/\.jsonl$/, '') === sessionId);
          if (matchingFile) {
            const fullPath = path.join(transcriptsDir, matchingFile);
            const stats = await fs.stat(fullPath);
            const realWorkspacePath = await this._resolveWorkspacePath(path.join(dir, hash));
            const session = await this._buildTranscriptSession(
              matchingFile, fullPath, stats, hash, realWorkspacePath || path.join(dir, hash)
            );
            if (session) candidates.push(session);
          }
        } catch {
          // No transcripts dir
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0));
        return candidates[0];
      }
    } catch (err) {
      console.error(`[VSCode findById] Error searching VSCode sessions: ${err.message}`);
    }
    return null;
  }

  async readEvents(session, _dir) {
    if (!session?.filePath) {
      return [];
    }

    try {
      return this.readJsonlEvents(session.filePath);
    } catch (err) {
      console.error(`[VSCode readEvents] Error reading session ${session.id}:`, err);
      return [];
    }
  }

  buildTimeline(_events, _session) {
    // All sessions are transcripts now — fall through to _buildCopilotTimeline via source dispatch
    return null;
  }

  // --- Private helpers ---

  async _scanWorkspaceDir(workspaceHashDir) {
    const workspaceHash = path.basename(workspaceHashDir);
    const realWorkspacePath = await this._resolveWorkspacePath(workspaceHashDir);
    const sessions = [];

    const transcriptsDir = path.join(workspaceHashDir, 'GitHub.copilot-chat', 'transcripts');
    try {
      await fs.access(transcriptsDir);
      const entries = await fs.readdir(transcriptsDir);
      const jsonlFiles = entries.filter(e => e.endsWith('.jsonl') && !shouldSkipEntry(e));
      for (const file of jsonlFiles) {
        const fullPath = path.join(transcriptsDir, file);
        try {
          const stats = await fs.stat(fullPath);
          const session = await this._buildTranscriptSession(
            file, fullPath, stats, workspaceHash, realWorkspacePath || workspaceHashDir
          );
          if (session) sessions.push(session);
        } catch (err) {
          console.warn(`[VSCode scan] Skipping transcript ${fullPath}: ${err.message}`);
        }
      }
    } catch { /* no transcripts dir */ }

    return sessions;
  }

  async _resolveWorkspacePath(workspaceHashDir) {
    try {
      const workspaceJsonPath = path.join(workspaceHashDir, 'workspace.json');
      const raw = await fs.readFile(workspaceJsonPath, 'utf-8');
      const meta = JSON.parse(raw);

      if (meta.folder) {
        return fileURLToPath(meta.folder);
      }

      if (meta.workspace) {
        const wsFilePath = fileURLToPath(meta.workspace);
        try {
          const wsRaw = await fs.readFile(wsFilePath, 'utf-8');
          const ws = JSON.parse(wsRaw);
          if (Array.isArray(ws.folders) && ws.folders.length > 0) {
            const wsDir = path.dirname(wsFilePath);
            return path.resolve(wsDir, ws.folders[0].path);
          }
        } catch {
          // Ignore nested read errors
        }
      }
    } catch {
      // No workspace.json or unreadable
    }
    return null;
  }

  /**
   * Build a Session from a copilot-agent transcript file.
   * Reuses the same metadata extraction as CopilotAdapter.
   */
  async _buildTranscriptSession(file, fullPath, stats, workspaceHash, workspaceCwd) {
    const sessionId = file.replace('.jsonl', '');
    const optimizedMetadata = await getSessionMetadataOptimized(fullPath);
    const sessionStatus = computeSessionStatus(optimizedMetadata);

    const createdAt = optimizedMetadata.startTime
      ? new Date(optimizedMetadata.startTime)
      : stats.birthtime;
    const updatedAt = optimizedMetadata.lastEventTime
      ? new Date(optimizedMetadata.lastEventTime)
      : stats.mtime;

    const session = new Session(sessionId, 'file', {
      source: 'vscode',
      filePath: fullPath,
      directory: path.dirname(fullPath),
      createdAt,
      updatedAt,
      summary: optimizedMetadata.firstUserMessage
        ? optimizedMetadata.firstUserMessage.slice(0, 120)
        : 'Copilot agent session',
      hasEvents: true,
      eventCount: optimizedMetadata.eventCount || 0,
      duration: optimizedMetadata.duration,
      sessionStatus,
      selectedModel: optimizedMetadata.selectedModel || null,
      copilotVersion: optimizedMetadata.copilotVersion || null,
      workspace: { cwd: workspaceCwd, workspaceHash },
    });
    session._isTranscript = true;
    return session;
  }
}

module.exports = VsCodeAdapter;
