const fs = require('fs');
const path = require('path');

describe('desktop renderer isolation and semantic theme tokens', () => {
  const root = path.join(__dirname, '..', '..', '..');

  it('runtime-gates the shell while keeping the dialog host available to browser mode', () => {
    const app = fs.readFileSync(path.join(root, 'src', 'client', 'App.vue'), 'utf8');
    expect(app).toContain('<DesktopShell v-if="desktopBridge"');
    expect(app).toContain('<router-view v-else');
    expect(app).toContain('<DesktopDialogHost');
  });

  it('defines title bar, menu, control, dialog, focus, and layering tokens', () => {
    const css = fs.readFileSync(
      path.join(root, 'src', 'client', 'styles', 'desktop.css'),
      'utf8'
    );
    for (const token of [
      '--desktop-titlebar-active-bg',
      '--desktop-titlebar-inactive-bg',
      '--desktop-menu-bg',
      '--desktop-control-close-hover-bg',
      '--desktop-dialog-overlay',
      '--desktop-focus-outline',
      '--desktop-disabled-fg',
      '--desktop-scrollbar-thumb',
      '--desktop-scrollbar-thumb-hover',
      '--desktop-titlebar-height',
      '--desktop-z-dialog'
    ]) {
      expect(css).toContain(token);
    }
    expect(css).toContain('.desktop-host body > #app');
    expect(css).toMatch(/\.desktop-shell__content\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(css).toContain('.desktop-shell__content::-webkit-scrollbar-thumb');
  });
});
