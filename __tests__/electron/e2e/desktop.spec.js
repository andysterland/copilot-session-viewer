const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { test, expect, _electron: electron } = require('@playwright/test');

const root = path.join(__dirname, '..', '..', '..');
const artifacts = path.join(root, '__tests__', '.artifacts', 'electron-e2e');
let electronApp;
let page;

test.beforeAll(async () => {
  await fs.promises.rm(artifacts, { recursive: true, force: true });
  await fs.promises.mkdir(artifacts, { recursive: true });
  electronApp = await electron.launch({
    args: [path.join(root, 'electron', 'main.js')],
    env: {
      ...process.env,
      E2E_USE_FIXTURES: '1',
      ELECTRON_USER_DATA_DIR: path.join(artifacts, 'user-data'),
      ELECTRON_TEST_DIRECTORY: path.join(root, '__tests__', 'fixtures', 'sessions', 'copilot-cli'),
      VISUAL_STUDIO_SESSION_DIR: path.join(root, '__tests__', 'fixtures', 'sessions', 'copilot-cli'),
      COPILOT_SESSION_DIR: path.join(root, '__tests__', 'fixtures', 'sessions', 'copilot-cli'),
      CLAUDE_SESSION_DIR: path.join(root, '__tests__', 'fixtures', 'sessions', 'claude'),
      PI_MONO_SESSION_DIR: path.join(root, '__tests__', 'fixtures', 'sessions', 'pi-mono'),
      VSCODE_WORKSPACE_STORAGE_DIR: path.join(root, '__tests__', 'fixtures', 'sessions', 'vscode-empty'),
      MODERNIZE_SESSION_DIR: path.join(root, '__tests__', 'fixtures', 'sessions', 'modernize-empty'),
      SESSION_DIR: path.join(artifacts, 'imported-sessions'),
      UPLOAD_DIR: path.join(artifacts, 'uploads'),
      CUSTOM_DIRS_REGISTRY: path.join(artifacts, 'registered-dirs.json'),
      KNOWN_TAGS_DIR: path.join(artifacts, 'tags'),
      ELECTRON_TEST_EXTERNAL_URL_FILE: path.join(artifacts, 'external-url.txt'),
      ELECTRON_TEST_EXPORT_PATH: path.join(artifacts, 'session-export.zip'),
      ELECTRON_ENABLE_UPDATES: 'false'
    }
  });
  page = await electronApp.firstWindow();
  await page.waitForSelector('[data-testid="desktop-title-bar"]');
});

test.afterAll(async () => {
  await electronApp?.close().catch(() => {});
  await fs.promises.rm(artifacts, { recursive: true, force: true });
});

test('renders fixture sessions in the isolated desktop host', async () => {
  await expect(page.getByTestId('desktop-title-bar')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Application menu' })).toBeVisible();
  await expect(page.getByTestId('home-title')).toBeHidden();
  await expect(page.getByTestId('session-list')).toBeVisible();
  const scrolling = await page.evaluate(() => {
    const content = document.querySelector('.desktop-shell__content');
    const sessionPane = document.querySelector('[data-testid="session-scroll"]');
    return {
      rootOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
      contentOverflowY: getComputedStyle(content).overflowY,
      contentScrollTop: content.scrollTop,
      sessionOverflowY: getComputedStyle(sessionPane).overflowY
    };
  });
  expect(scrolling).toEqual(expect.objectContaining({
    rootOverflow: 'hidden',
    bodyOverflow: 'hidden',
    contentOverflowY: 'auto',
    contentScrollTop: 0,
    sessionOverflowY: 'auto'
  }));
});

test('keeps Node and arbitrary Electron APIs out of the renderer', async () => {
  const security = await page.evaluate(() => ({
    nodeProcess: typeof globalThis.process,
    nodeRequire: typeof globalThis.require,
    bridgeKeys: Object.keys(globalThis.copilotSessionViewer).sort()
  }));
  expect(security.nodeProcess).toBe('undefined');
  expect(security.nodeRequire).toBe('undefined');
  expect(security.bridgeKeys).toEqual([
    'checkForUpdates',
    'closeWindow',
    'executeMenuCommand',
    'exportDiagnostics',
    'exportSession',
    'getMenuCommands',
    'getSettings',
    'getWindowState',
    'isDesktop',
    'isWindowMaximized',
    'minimizeWindow',
    'notifyDialogHostReady',
    'notifyShellReady',
    'onDialogCancel',
    'onDialogRequest',
    'onMenuCommand',
    'onUpdateStatus',
    'onWindowMaximizedChanged',
    'onWindowStateChanged',
    'openLogs',
    'respondToDialog',
    'selectDirectory',
    'selectExecutable',
    'toggleMaximizeWindow',
    'updateSettings'
  ]);
});

test('synchronizes maximize, restore, double-click, and minimize controls', async () => {
  const platform = await page.evaluate(async () => (
    await globalThis.copilotSessionViewer.getWindowState()
  ).platform);
  if (platform === 'darwin') {
    await expect(page.getByTestId('window-minimize')).toHaveCount(0);
    return;
  }

  await page.getByTestId('window-maximize').click();
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0].isMaximized()
  ))).toBe(true);
  await expect(page.getByTestId('window-maximize')).toHaveAttribute('aria-label', 'Restore');

  await page.getByTestId('window-maximize').click();
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0].isMaximized()
  ))).toBe(false);

  await page.getByTestId('desktop-title-bar').dblclick({ position: { x: 650, y: 18 } });
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0].isMaximized()
  ))).toBe(true);
  await page.getByTestId('desktop-title-bar').dblclick({ position: { x: 650, y: 18 } });
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0].isMaximized()
  ))).toBe(false);

  await page.getByTestId('window-minimize').click();
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0].isMinimized()
  ))).toBe(true);
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.restore();
    window.show();
    window.focus();
  });
  await page.bringToFront();
});

test('supports pointer and keyboard menu navigation with focus restoration', async () => {
  const fileMenu = page.getByRole('button', { name: 'File' });
  const platform = await page.evaluate(async () => (
    await globalThis.copilotSessionViewer.getWindowState()
  ).platform);
  if (platform !== 'darwin') {
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        autoHide: window.isMenuBarAutoHide(),
        visible: window.isMenuBarVisible()
      };
    })).toEqual({ autoHide: false, visible: false });
    await page.keyboard.press('Alt');
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0].isMenuBarVisible()
    ))).toBe(false);
  }

  await fileMenu.click();
  await expect(page.getByRole('menu', { name: 'File menu' })).toBeVisible();
  await expect(page.getByRole('separator')).toBeVisible();
  await page.getByPlaceholder('Enter Session ID...').click();
  await expect(page.getByRole('menu', { name: 'File menu' })).toHaveCount(0);

  await page.keyboard.press('F10');
  await expect(fileMenu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'File menu' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: 'View menu' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'View menu' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'File' })).toBeFocused();
});

test('uses the native directory bridge and registers the selected directory', async () => {
  await page.getByTestId('add-dir-btn').click();
  await expect(page.getByText(
    path.join(root, '__tests__', 'fixtures', 'sessions', 'copilot-cli'),
    { exact: true }
  )).toBeVisible();
});

test('imports a ZIP without an operating-system unzip dependency', async () => {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const zipPath = path.join(artifacts, 'session.zip');
  const zip = new AdmZip();
  zip.addFile(`${sessionId}/events.jsonl`, Buffer.from(
    `${JSON.stringify({ type: 'user.message', timestamp: new Date().toISOString(), data: { content: 'fixture' } })}\n`
  ));
  zip.writeZip(zipPath);

  await page.locator('input[type=file]').setInputFiles(zipPath);
  await expect(page.getByText(new RegExp(`Session ${sessionId} imported successfully`))).toBeVisible();
});

test('exports a session through the validated desktop bridge', async () => {
  const origin = await page.evaluate(() => window.location.origin);
  const exportPath = path.join(artifacts, 'session-export.zip');
  await page.goto(`${origin}/#/copilot-cli/session/session-demo`);
  await page.waitForSelector('[data-testid="session-layout"]');
  await page.getByTestId('export-btn').click();

  await expect.poll(async () => {
    try {
      return (await fs.promises.stat(exportPath)).size;
    } catch {
      return 0;
    }
  }).toBeGreaterThan(0);

  const zip = new AdmZip(exportPath);
  expect(zip.getEntries().some(entry => entry.entryName.endsWith('events.jsonl'))).toBe(true);
  await page.goto(`${origin}/#/`);
  await expect(page.getByTestId('session-list')).toBeVisible();
});

test('opens approved external links outside the renderer', async () => {
  await page.evaluate(() => window.open('https://example.com/desktop-test'));
  await expect.poll(async () => {
    try {
      return await fs.promises.readFile(path.join(artifacts, 'external-url.txt'), 'utf8');
    } catch {
      return '';
    }
  }).toBe('https://example.com/desktop-test');
});

test('can load and update versioned desktop settings', async () => {
  await expect(page.getByRole('button', { name: 'Desktop Settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /Desktop Settings/ }).click();
  await expect(page).toHaveURL(/#\/desktop\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Updates' })).toBeVisible();
  const settings = await page.evaluate(() => globalThis.copilotSessionViewer.getSettings());
  expect(settings.version).toBe(2);
  expect(settings).not.toHaveProperty('telemetryEnabled');
});

test('presents accessible prompt and destructive confirmation dialogs', async () => {
  const enterPath = page.getByRole('button', { name: 'Enter Path' }).first();
  await enterPath.click();
  const prompt = page.getByTestId('desktop-dialog');
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute('role', 'dialog');
  await expect(prompt).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('desktop-dialog-input')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('desktop-dialog-action-cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('desktop-dialog-input')).toBeFocused();
  await page.getByTestId('desktop-dialog-input').fill('C:\\tools\\copilot.exe');
  await page.getByTestId('desktop-dialog-input').evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true
    }));
  });
  await expect(prompt).toBeVisible();
  await page.getByTestId('desktop-dialog-input').evaluate(element => {
    const event = new Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      key: { value: 'Escape' },
      keyCode: { value: 229 },
      isComposing: { value: false }
    });
    element.dispatchEvent(event);
  });
  await expect(prompt).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
  await expect(enterPath).toBeFocused();

  await enterPath.click();
  await page.getByTestId('desktop-dialog-input').fill('C:\\tools\\copilot.exe');
  await page.keyboard.press('Enter');
  await expect(prompt).toHaveCount(0);

  const clearPath = page.getByRole('button', { name: 'Clear' }).first();
  await clearPath.click();
  await expect(page.getByText('Clear copilot executable path?')).toBeVisible();
  await expect(page.getByTestId('desktop-dialog-action-confirm')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Clear copilot executable path?')).toHaveCount(0);
  await expect(clearPath).toBeFocused();

  await clearPath.click();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Clear copilot executable path?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear' }).first()).toHaveCount(0);
});

test('routes main-process informational dialogs through the renderer', async () => {
  const helpMenu = page.getByRole('button', { name: 'Help' });
  await helpMenu.click();
  await page.getByRole('menuitem', { name: 'About Copilot Session Viewer' }).click();
  await expect(page.getByTestId('desktop-dialog')).toContainText('About Copilot Session Viewer');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('desktop-dialog')).toHaveCount(0);
  await expect(helpMenu).toBeFocused();
});

test('removes a correlated renderer dialog when the main process cancels it', async () => {
  const requestId = crypto.randomUUID();
  await electronApp.evaluate(({ BrowserWindow }, request) => {
    BrowserWindow.getAllWindows()[0].webContents.send('desktop:dialog-request', request);
  }, {
    requestId,
    descriptor: {
      type: 'info',
      title: 'Pending renderer dialog',
      message: 'This dialog should be cancelled.',
      buttons: [{ id: 'ok', label: 'OK', role: 'primary' }],
      defaultId: 'ok',
      cancelId: 'ok'
    }
  });
  await expect(page.getByTestId('desktop-dialog')).toContainText('Pending renderer dialog');

  await electronApp.evaluate(({ BrowserWindow }, cancellation) => {
    BrowserWindow.getAllWindows()[0].webContents.send('desktop:dialog-cancel', cancellation);
  }, { requestId });
  await expect(page.getByTestId('desktop-dialog')).toHaveCount(0);
});

test('uses the custom close control lifecycle', async () => {
  const platform = await page.evaluate(async () => (
    await globalThis.copilotSessionViewer.getWindowState()
  ).platform);
  const windowClosed = page.waitForEvent('close');
  if (platform === 'darwin') {
    await page.evaluate(() => globalThis.copilotSessionViewer.closeWindow());
  } else {
    await page.getByTestId('window-close').click();
  }
  await windowClosed;
});
