const ADD_DIRECTORY_ARGUMENT = '--add-session-directory';

function hasAddDirectoryArgument(commandLine = []) {
  return commandLine.includes(ADD_DIRECTORY_ARGUMENT);
}

function createWindowsJumpList({ executablePath, iconPath }) {
  return [{
    type: 'tasks',
    items: [{
      type: 'task',
      program: executablePath,
      args: ADD_DIRECTORY_ARGUMENT,
      iconPath,
      iconIndex: 0,
      title: 'Add Local Session Folder',
      description: 'Add a local session folder to Copilot Session Viewer'
    }]
  }];
}

module.exports = {
  ADD_DIRECTORY_ARGUMENT,
  createWindowsJumpList,
  hasAddDirectoryArgument
};
