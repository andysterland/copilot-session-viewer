const path = require('path');
const os = require('os');
const VisualStudioAdapter = require('../../src/server/adapters/VisualStudioAdapter');

describe('VisualStudioAdapter', () => {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  let adapter;

  beforeEach(() => {
    adapter = new VisualStudioAdapter();
  });

  afterEach(() => {
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }
    delete process.env.VISUAL_STUDIO_SESSION_DIR;
  });

  it('identifies Visual Studio sessions', () => {
    expect(adapter.type).toBe('visual-studio');
    expect(adapter.displayName).toBe('Visual Studio');
    expect(adapter.envVar).toBe('VISUAL_STUDIO_SESSION_DIR');
    expect(adapter.displayMetadata).toEqual({
      name: 'Visual Studio',
      badgeClass: 'source-visual-studio'
    });
  });

  it('uses the Visual Studio Copilot CLI session directory', () => {
    process.env.LOCALAPPDATA = path.join('C:', 'Users', 'andster', 'AppData', 'Local');

    expect(adapter.getDefaultDir()).toBe(path.join(
      process.env.LOCALAPPDATA,
      'Microsoft',
      'VisualStudio',
      'CopilotCli',
      'session-state'
    ));
  });

  it('falls back to the current user local application data directory', () => {
    delete process.env.LOCALAPPDATA;

    expect(adapter.getDefaultDir()).toBe(path.join(
      os.homedir(),
      'AppData',
      'Local',
      'Microsoft',
      'VisualStudio',
      'CopilotCli',
      'session-state'
    ));
  });

  it('does not claim generic Copilot ZIP imports', async () => {
    await expect(adapter.detectImportCandidate('unused')).resolves.toMatchObject({
      matched: false,
      score: 0
    });
  });
});
