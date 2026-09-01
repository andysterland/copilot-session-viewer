const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');
const artifacts = path.join(root, '__tests__', '.artifacts', 'electron-smoke');
const fixtures = path.join(root, '__tests__', 'fixtures', 'sessions');

function getExecutable() {
  const releaseDirectory = path.join(__dirname, '..', '..', 'release', 'electron');
  if (process.platform === 'win32') {
    return path.join(releaseDirectory, 'win-unpacked', 'copilot-session-viewer.exe');
  }
  if (process.platform === 'darwin') {
    return path.join(
      releaseDirectory,
      'mac',
      'Copilot Session Viewer.app',
      'Contents',
      'MacOS',
      'Copilot Session Viewer'
    );
  }
  return path.join(releaseDirectory, 'linux-unpacked', 'copilot-session-viewer');
}

const executable = getExecutable();
if (!fs.existsSync(executable)) {
  throw new Error(`Packaged executable was not found: ${executable}`);
}

fs.rmSync(artifacts, { recursive: true, force: true });
fs.mkdirSync(artifacts, { recursive: true });

const child = spawn(executable, ['--smoke-test'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_USE_FIXTURES: '1',
    ELECTRON_ENABLE_UPDATES: 'false',
    ELECTRON_USER_DATA_DIR: path.join(artifacts, 'user-data'),
    VISUAL_STUDIO_SESSION_DIR: path.join(fixtures, 'copilot-cli'),
    COPILOT_SESSION_DIR: path.join(fixtures, 'copilot-cli'),
    CLAUDE_SESSION_DIR: path.join(fixtures, 'claude'),
    PI_MONO_SESSION_DIR: path.join(fixtures, 'pi-mono'),
    VSCODE_WORKSPACE_STORAGE_DIR: path.join(fixtures, 'vscode-empty'),
    MODERNIZE_SESSION_DIR: path.join(fixtures, 'modernize-empty'),
    SESSION_DIR: path.join(artifacts, 'imported-sessions'),
    UPLOAD_DIR: path.join(artifacts, 'uploads'),
    CUSTOM_DIRS_REGISTRY: path.join(artifacts, 'registered-dirs.json'),
    KNOWN_TAGS_DIR: path.join(artifacts, 'tags')
  }
});
function cleanup() {
  fs.rmSync(artifacts, { recursive: true, force: true });
}
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill('SIGTERM');
  console.error('Packaged Electron smoke test timed out');
  process.exitCode = 1;
}, 30000);
child.on('exit', code => {
  clearTimeout(timeout);
  cleanup();
  process.exitCode = timedOut ? 1 : (code ?? 1);
});
child.on('error', error => {
  clearTimeout(timeout);
  cleanup();
  console.error('Packaged Electron smoke test failed:', error.message);
  process.exitCode = 1;
});
