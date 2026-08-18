const {
  MENU_COMMAND_IDS,
  getAccelerator,
  getMenuModel
} = require('../../../electron/menuCommands');

describe('shared desktop menu command definitions', () => {
  it('defines accessible File, View, and Help command groups', () => {
    const menus = getMenuModel('win32', false);
    expect(menus.map(menu => menu.label)).toEqual(['File', 'View', 'Help']);
    expect(MENU_COMMAND_IDS).toEqual(expect.arrayContaining([
      'file.add-directory',
      'file.desktop-settings',
      'view.zoom-in',
      'help.about'
    ]));
    const settings = menus[0].items.find(item => item.id === 'file.desktop-settings');
    expect(settings.accelerator).toBe('Ctrl+,');
    expect(menus.flatMap(menu => menu.items)).toContainEqual({ type: 'separator' });
  });

  it('shares platform accelerators and packaged disabled state', () => {
    const command = { accelerator: { default: 'Ctrl+O', darwin: 'Cmd+O' } };
    expect(getAccelerator(command, 'win32')).toBe('Ctrl+O');
    expect(getAccelerator(command, 'darwin')).toBe('Cmd+O');
    const developerTools = getMenuModel('linux', true)
      .flatMap(menu => menu.items)
      .find(item => item.id === 'view.developer-tools');
    expect(developerTools.disabled).toBe(true);
  });
});
