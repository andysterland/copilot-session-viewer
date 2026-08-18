const {
  ADD_DIRECTORY_ARGUMENT,
  createWindowsJumpList,
  hasAddDirectoryArgument
} = require('../../../electron/jumpList');

describe('Windows Jump List', () => {
  it('recognizes only the explicit add-directory launch argument', () => {
    expect(hasAddDirectoryArgument(['app.exe', ADD_DIRECTORY_ARGUMENT])).toBe(true);
    expect(hasAddDirectoryArgument(['app.exe', '--other-action'])).toBe(false);
  });

  it('creates a branded task that relaunches the current executable', () => {
    expect(createWindowsJumpList({
      executablePath: 'C:\\Program Files\\Copilot Session Viewer\\app.exe',
      iconPath: 'C:\\Program Files\\Copilot Session Viewer\\icon.ico'
    })).toEqual([{
      type: 'tasks',
      items: [{
        type: 'task',
        program: 'C:\\Program Files\\Copilot Session Viewer\\app.exe',
        args: ADD_DIRECTORY_ARGUMENT,
        iconPath: 'C:\\Program Files\\Copilot Session Viewer\\icon.ico',
        iconIndex: 0,
        title: 'Add Local Session Folder',
        description: 'Add a local session folder to Copilot Session Viewer'
      }]
    }]);
  });
});
