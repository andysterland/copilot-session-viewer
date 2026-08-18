/**
 * Shared declarative menu model consumed by Electron accelerators and the Vue menu bar.
 */
const MENU_COMMANDS = Object.freeze([
  {
    id: 'file',
    label: 'File',
    mnemonic: 'F',
    items: [
      {
        id: 'file.add-directory',
        label: 'Add Session Directory…',
        accelerator: { default: 'Ctrl+O', darwin: 'Cmd+O' },
        target: 'renderer'
      },
      {
        id: 'file.desktop-settings',
        label: 'Desktop Settings',
        accelerator: { default: 'Ctrl+,', darwin: 'Cmd+,' },
        target: 'renderer'
      },
      { type: 'separator' },
      {
        id: 'file.close-window',
        label: 'Close Window',
        accelerator: { default: 'Alt+F4', darwin: 'Cmd+W' },
        target: 'main'
      }
    ]
  },
  {
    id: 'view',
    label: 'View',
    mnemonic: 'V',
    items: [
      {
        id: 'view.reload',
        label: 'Reload',
        accelerator: { default: 'Ctrl+R', darwin: 'Cmd+R' },
        target: 'main'
      },
      { type: 'separator' },
      {
        id: 'view.zoom-in',
        label: 'Zoom In',
        accelerator: { default: 'Ctrl+=', darwin: 'Cmd+=' },
        target: 'main'
      },
      {
        id: 'view.zoom-out',
        label: 'Zoom Out',
        accelerator: { default: 'Ctrl+-', darwin: 'Cmd+-' },
        target: 'main'
      },
      {
        id: 'view.zoom-reset',
        label: 'Reset Zoom',
        accelerator: { default: 'Ctrl+0', darwin: 'Cmd+0' },
        target: 'main'
      },
      { type: 'separator' },
      {
        id: 'view.toggle-full-screen',
        label: 'Toggle Full Screen',
        accelerator: { default: 'F11', darwin: 'Ctrl+Cmd+F' },
        target: 'main'
      },
      {
        id: 'view.developer-tools',
        label: 'Developer Tools',
        accelerator: { default: 'Ctrl+Shift+I', darwin: 'Alt+Cmd+I' },
        target: 'main',
        developmentOnly: true
      }
    ]
  },
  {
    id: 'help',
    label: 'Help',
    mnemonic: 'H',
    items: [
      {
        id: 'help.check-updates',
        label: 'Check for Updates',
        target: 'main'
      },
      { type: 'separator' },
      {
        id: 'help.about',
        label: 'About Copilot Session Viewer',
        target: 'main'
      }
    ]
  }
]);

const MENU_COMMAND_IDS = Object.freeze(
  MENU_COMMANDS.flatMap(menu => menu.items)
    .filter(item => item.id)
    .map(item => item.id)
);
const WINDOW_INDEPENDENT_COMMAND_IDS = Object.freeze([
  'help.check-updates',
  'help.about'
]);

function isWindowIndependentCommand(commandId) {
  return WINDOW_INDEPENDENT_COMMAND_IDS.includes(commandId);
}

function getAccelerator(command, platform = process.platform) {
  if (!command.accelerator) return undefined;
  return command.accelerator[platform] || command.accelerator.default;
}

/**
 * Returns a renderer-safe menu model with platform accelerators and dynamic disabled states.
 */
function getMenuModel(platform = process.platform, packaged = false) {
  return MENU_COMMANDS.map(menu => ({
    id: menu.id,
    label: menu.label,
    mnemonic: menu.mnemonic,
    items: menu.items.map(item => {
      if (item.type === 'separator') return { type: 'separator' };
      return {
        id: item.id,
        label: item.label,
        accelerator: getAccelerator(item, platform),
        disabled: item.developmentOnly === true && packaged,
        target: item.target
      };
    })
  }));
}

module.exports = {
  MENU_COMMANDS,
  MENU_COMMAND_IDS,
  WINDOW_INDEPENDENT_COMMAND_IDS,
  getAccelerator,
  getMenuModel,
  isWindowIndependentCommand
};
