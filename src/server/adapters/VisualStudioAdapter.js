const path = require('path');
const os = require('os');
const CopilotAdapter = require('./CopilotAdapter');

class VisualStudioAdapter extends CopilotAdapter {
  get type() { return 'visual-studio'; }
  get displayName() { return 'Visual Studio'; }
  get envVar() { return 'VISUAL_STUDIO_SESSION_DIR'; }

  getDefaultDir() {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Microsoft', 'VisualStudio', 'CopilotCli', 'session-state');
  }

  async detectImportCandidate(_extractDir) {
    return {
      matched: false,
      score: 0,
      reason: 'Visual Studio sessions are discovered from the Visual Studio session directory'
    };
  }
}

module.exports = VisualStudioAdapter;
