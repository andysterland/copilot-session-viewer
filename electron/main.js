const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  screen,
  session,
  shell
} = require('electron');
const { SettingsStore } = require('./settings');
const { initializeLogger } = require('./logger');
const { exportDiagnostics } = require('./diagnostics');
const {
  CHANNELS,
  dialogResponseSchema,
  executableSchema,
  exportSessionSchema,
  isTrustedSender,
  menuCommandSchema,
  noArgumentSchema,
  shellStatusSchema,
  settingsPatchSchema
} = require('./ipc');
const { RendererDialogCoordinator } = require('./dialogCoordinator');
const {
  MENU_COMMANDS,
  getAccelerator,
  getMenuModel,
  isWindowIndependentCommand
} = require('./menuCommands');
const {
  configureNativeMenuVisibility,
  createWindowOptions,
  getVisibleWindowBounds
} = require('./windowConfig');
const { showApplicationDialog: presentApplicationDialog } = require('./applicationDialog');
const { createUpdater } = require('./updater');
const {
  createWindowsJumpList,
  hasAddDirectoryArgument
} = require('./jumpList');
const { STARTUP_TOKEN_HEADER } = require('../src/server/middleware/desktopSecurity');

const APP_USER_MODEL_ID = 'com.github.andysterland.copilot-session-viewer';

if (process.env.E2E_USE_FIXTURES === '1' && process.env.ELECTRON_USER_DATA_DIR) {
  const testUserData = path.resolve(process.env.ELECTRON_USER_DATA_DIR);
  app.setPath('userData', testUserData);
  app.setPath('logs', path.join(testUserData, 'logs'));
}

let mainWindow = null;
let serverHandle = null;
let settingsStore = null;
let logger = null;
let updater = null;
let dialogCoordinator = null;
let appOrigin = null;
let shuttingDown = false;
let restartInProgress = false;
let rendererAuthenticated = false;
let serverRecoveryAttempts = 0;
let serverRecoveryPromptActive = false;
let serverRecoveryResetTimer = null;
let rendererShellReady = false;
let pendingAddDirectory = hasAddDirectoryArgument(process.argv);
const SERVER_RECOVERY_LIMIT = 1;
const SERVER_RECOVERY_STABLE_MS = 30000;
const isSmokeTest = process.argv.includes('--smoke-test');
const smokeTimeout = isSmokeTest
  ? setTimeout(() => app.exit(1), 25000)
  : null;

function getApplicationRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function createSecurityTokens() {
  return {
    startupToken: crypto.randomBytes(32).toString('hex'),
    sessionToken: crypto.randomBytes(32).toString('hex'),
    csrfToken: crypto.randomBytes(32).toString('hex')
  };
}

/**
 * Registers a trusted-main-frame IPC handler with mandatory argument validation.
 */
function registerIpcHandler(channel, schema, handler) {
  ipcMain.handle(channel, async (event, argument) => {
    const correlationId = crypto.randomUUID();
    if (!isTrustedSender(event, appOrigin, mainWindow?.webContents)) {
      logger.warn('ipc.rejected', { correlationId, channel });
      throw new Error('IPC sender is not authorized');
    }
    try {
      const parsedArgument = schema.parse(argument);
      logger.info('ipc.started', { correlationId, channel });
      const result = await handler(parsedArgument, correlationId, event);
      logger.info('ipc.completed', { correlationId, channel });
      return result;
    } catch (error) {
      logger.error('ipc.failed', { correlationId, channel, error });
      throw new Error(`Desktop operation failed (${correlationId})`, { cause: error });
    }
  });
}

function getWindowState(window = mainWindow) {
  if (!window || window.isDestroyed()) {
    throw new Error('Application window is unavailable');
  }
  const display = screen.getDisplayMatching(window.getBounds());
  return {
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
    focused: window.isFocused(),
    fullScreen: window.isFullScreen(),
    scaleFactor: display.scaleFactor,
    platform: process.platform
  };
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNELS.WINDOW_STATE_CHANGED, getWindowState());
}

function registerWindowStateEvents(window) {
  const stateEvents = [
    ['maximize', 'window.maximized'],
    ['unmaximize', 'window.restored'],
    ['minimize', 'window.minimized'],
    ['restore', 'window.restored'],
    ['focus', 'window.focused'],
    ['blur', 'window.blurred'],
    ['enter-full-screen', 'window.full-screen-entered'],
    ['leave-full-screen', 'window.full-screen-left']
  ];
  for (const [eventName, logEvent] of stateEvents) {
    window.on(eventName, () => {
      logger.info(logEvent);
      sendWindowState();
    });
  }
  window.on('resize', sendWindowState);
  window.on('move', sendWindowState);
}

function activateMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function dispatchPendingAddDirectory() {
  if (!pendingAddDirectory
    || !rendererShellReady
    || !mainWindow
    || mainWindow.isDestroyed()) {
    return false;
  }
  pendingAddDirectory = false;
  mainWindow.webContents.send(CHANNELS.MENU_COMMAND, 'file.add-directory');
  logger.info('jump-list.add-directory-dispatched');
  return true;
}

async function createMainWindow() {
  const settings = settingsStore.get();
  const windowBounds = getVisibleWindowBounds(settings.window, screen);
  mainWindow = new BrowserWindow(createWindowOptions({
    platform: process.platform,
    bounds: windowBounds,
    preloadPath: path.join(__dirname, 'preload.js'),
    iconPath: path.join(
      __dirname,
      'assets',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    ),
    packaged: app.isPackaged
  }));
  configureNativeMenuVisibility(mainWindow, process.platform);

  if (settings.window.maximized) mainWindow.maximize();
  registerWindowStateEvents(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== appOrigin) openApprovedExternalUrl(url);
    } catch (error) {
      logger.warn('window-open.rejected', { error });
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url);
    if (destination.origin !== appOrigin) {
      event.preventDefault();
      openApprovedExternalUrl(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame && !_isInPlace) {
      rendererShellReady = false;
      dialogCoordinator?.markUnavailable();
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    dialogCoordinator?.markUnavailable();
    logger.error('renderer.gone', { reason: details.reason, exitCode: details.exitCode });
    showRendererRecovery('The application renderer stopped unexpectedly.');
  });
  mainWindow.on('unresponsive', () => {
    logger.warn('renderer.unresponsive');
    showRendererRecovery('The application window is not responding.');
  });
  mainWindow.on('close', () => {
    logger.info('window.close-requested');
    const bounds = mainWindow.getNormalBounds();
    settingsStore.update({
      window: {
        ...bounds,
        maximized: mainWindow.isMaximized()
      }
    }).catch(error => logger.error('settings.window-save-failed', { error }));
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    rendererShellReady = false;
    dialogCoordinator?.markUnavailable();
    mainWindow = null;
  });

  if (rendererAuthenticated) {
    await mainWindow.loadURL(`${serverHandle.url}/`);
  } else {
    await loadAuthenticatedPage(mainWindow, serverHandle);
  }
  rendererAuthenticated = true;
  logger.info('window.created', { frameStyle: process.platform === 'darwin' ? 'native-inset' : 'custom' });
  if (isSmokeTest) {
    clearTimeout(smokeTimeout);
    setTimeout(() => app.quit(), 500);
  }
}

function loadAuthenticatedPage(window, handle) {
  return window.loadURL(`${handle.url}/desktop-auth`, {
    extraHeaders: `${STARTUP_TOKEN_HEADER}: ${handle.startupToken}\n`
  });
}

function openApprovedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return;
    if (process.env.E2E_USE_FIXTURES === '1' && process.env.ELECTRON_TEST_EXTERNAL_URL_FILE) {
      fs.writeFileSync(process.env.ELECTRON_TEST_EXTERNAL_URL_FILE, parsed.toString(), 'utf8');
      return;
    }
    shell.openExternal(parsed.toString()).catch(error => {
      logger.error('external-link.failed', { error });
    });
  } catch (error) {
    logger.warn('external-link.rejected', { error });
  }
}

async function showApplicationDialog(descriptor, { nativeFallback = true } = {}) {
  return presentApplicationDialog(descriptor, {
    coordinator: dialogCoordinator,
    dialog,
    getWindow: () => mainWindow,
    isShuttingDown: () => shuttingDown,
    logger,
    nativeFallback
  });
}

function buildApplicationMenu() {
  const commandMenu = MENU_COMMANDS.map(menu => ({
    label: menu.label,
    submenu: menu.items.map(command => {
      if (command.type === 'separator') return { type: 'separator' };
      const disabled = command.developmentOnly === true && app.isPackaged;
      return {
        label: command.label,
        accelerator: getAccelerator(command, process.platform),
        enabled: !disabled,
        click: () => {
          executeMenuCommand(command.id)
            .catch(error => logger.error('menu.command-failed', {
              commandId: command.id,
              error
            }));
        }
      };
    })
  }));
  if (process.platform === 'darwin') {
    commandMenu.unshift({
      label: app.name,
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => {
            executeMenuCommand('help.about')
              .catch(error => logger.error('menu.command-failed', {
                commandId: 'help.about',
                error
              }));
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(commandMenu));
}

async function executeMenuCommand(commandId) {
  const parsedCommand = menuCommandSchema.parse(commandId);
  logger.info('menu.command-executed', { commandId: parsedCommand });
  if (isWindowIndependentCommand(parsedCommand)) {
    if (parsedCommand === 'help.check-updates') {
      await updater.checkForUpdates();
    } else {
      await showApplicationDialog({
        type: 'info',
        title: 'About Copilot Session Viewer',
        message: `Copilot Session Viewer ${app.getVersion()}`,
        detail: 'A local viewer for AI coding-agent session logs.',
        buttons: [{ id: 'ok', label: 'OK', role: 'primary' }],
        defaultId: 'ok',
        cancelId: 'ok'
      });
    }
    return true;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const rendererCommand = getMenuModel(process.platform, app.isPackaged)
    .flatMap(menu => menu.items)
    .find(command => command.id === parsedCommand && command.target === 'renderer');
  if (rendererCommand) {
    mainWindow.webContents.send(CHANNELS.MENU_COMMAND, parsedCommand);
    return true;
  }

  switch (parsedCommand) {
    case 'file.close-window':
      mainWindow.close();
      break;
    case 'view.reload':
      mainWindow.reload();
      break;
    case 'view.zoom-in':
      mainWindow.webContents.setZoomLevel(
        Math.min(5, mainWindow.webContents.getZoomLevel() + 0.5)
      );
      break;
    case 'view.zoom-out':
      mainWindow.webContents.setZoomLevel(
        Math.max(-3, mainWindow.webContents.getZoomLevel() - 0.5)
      );
      break;
    case 'view.zoom-reset':
      mainWindow.webContents.setZoomLevel(0);
      break;
    case 'view.toggle-full-screen':
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      break;
    case 'view.developer-tools':
      if (!app.isPackaged) mainWindow.webContents.toggleDevTools();
      break;
    default:
      throw new Error(`Unsupported menu command: ${parsedCommand}`);
  }
  return true;
}

async function showRendererRecovery(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Renderer failures cannot safely depend on the renderer dialog host.
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Copilot Session Viewer',
    message,
    detail: 'Reload the window to recover. Diagnostic logs remain available from Desktop Settings.',
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) mainWindow.reload();
  else app.quit();
}

async function startEmbeddedServer() {
  const root = getApplicationRoot();
  const security = createSecurityTokens();
  const { startServer } = require('../src/server/lifecycle');
  const createApp = require('../src/server/app');
  const InsightService = require('../src/server/services/insightService');
  const embeddedApp = createApp({
    clientDirectory: path.join(root, 'dist', 'client'),
    publicDirectory: path.join(root, 'public'),
    desktopSecurity: security,
    logger,
    insightService: new InsightService({ logger })
  });
  const handle = await startServer({
    app: embeddedApp,
    host: '127.0.0.1',
    port: 0,
    logger
  });
  handle.startupToken = security.startupToken;
  rendererAuthenticated = false;
  appOrigin = handle.url;
  handle.server.once('close', () => {
    if (!shuttingDown) recoverEmbeddedServer();
  });
  return handle;
}

async function recoverEmbeddedServer() {
  if (restartInProgress || shuttingDown) return;
  if (serverRecoveryAttempts >= SERVER_RECOVERY_LIMIT) {
    logger.error('server.recovery-limit-reached');
    await showServerRecovery();
    return;
  }
  serverRecoveryAttempts++;
  restartInProgress = true;
  logger.error('server.unexpected-stop');
  let recoveryFailed = false;
  try {
    serverHandle = await startEmbeddedServer();
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadAuthenticatedPage(mainWindow, serverHandle);
      rendererAuthenticated = true;
    }
    logger.info('server.recovered');
    clearTimeout(serverRecoveryResetTimer);
    const recoveredHandle = serverHandle;
    serverRecoveryResetTimer = setTimeout(() => {
      if (!shuttingDown && serverHandle === recoveredHandle && recoveredHandle.server.listening) {
        serverRecoveryAttempts = 0;
        logger.info('server.recovery-stable');
      }
    }, SERVER_RECOVERY_STABLE_MS);
  } catch (error) {
    recoveryFailed = true;
    logger.error('server.recovery-failed', { error });
  } finally {
    restartInProgress = false;
  }
  if (recoveryFailed) await showServerRecovery('The local application server could not restart.');
}

async function showServerRecovery(message = 'The local application server stopped repeatedly.') {
  if (serverRecoveryPromptActive || !mainWindow || mainWindow.isDestroyed()) return;
  serverRecoveryPromptActive = true;
  try {
    const result = await showApplicationDialog({
      type: 'error',
      title: 'Local server unavailable',
      message,
      detail: 'Retry the local server or quit and export diagnostics after restarting.',
      buttons: [
        { id: 'retry', label: 'Retry', role: 'primary' },
        { id: 'quit', label: 'Quit', role: 'cancel' }
      ],
      defaultId: 'retry',
      cancelId: 'quit'
    });
    if (result.action === 'retry') {
      serverRecoveryAttempts = 0;
      serverRecoveryPromptActive = false;
      await recoverEmbeddedServer();
    } else {
      app.quit();
    }
  } finally {
    serverRecoveryPromptActive = false;
  }
}

function configureEnvironment(settings) {
  process.env.DISABLE_TELEMETRY = settings.telemetryEnabled ? 'false' : 'true';
  process.env.PROCESS_MANAGER_DISABLE_SIGNAL_HANDLERS = 'true';
  process.env.CUSTOM_DIRS_REGISTRY = path.join(app.getPath('userData'), 'registered-dirs.json');
  process.env.KNOWN_TAGS_DIR = path.join(app.getPath('userData'), 'tags');
  for (const executable of ['copilot', 'claude', 'pi']) {
    const value = settings.executablePaths[executable];
    const environmentName = `${executable.toUpperCase()}_CLI_PATH`;
    if (value) process.env[environmentName] = value;
    else delete process.env[environmentName];
  }
}

async function exportSession({ source, sessionId }) {
  let destination;
  if (process.env.E2E_USE_FIXTURES === '1' && process.env.ELECTRON_TEST_EXPORT_PATH) {
    destination = path.resolve(process.env.ELECTRON_TEST_EXPORT_PATH);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export session',
      defaultPath: path.join(app.getPath('downloads'), `session-${sessionId}.zip`),
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return null;
    destination = result.filePath;
  }

  const exportUrl = new URL(
    `/api/${encodeURIComponent(source)}/sessions/${encodeURIComponent(sessionId)}/export`,
    appOrigin
  );
  const response = await mainWindow.webContents.session.fetch(exportUrl, {
    credentials: 'include',
    redirect: 'error'
  });
  if (!response.ok) {
    throw new Error(`Session export failed with status ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/zip') || !response.body) {
    throw new Error('Session export returned an invalid archive response');
  }

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(destination, { mode: 0o600 })
    );
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw new Error('Session export could not be saved', { cause: error });
  }
  return destination;
}

function registerIpcHandlers() {
  registerIpcHandler(CHANNELS.SELECT_DIRECTORY, noArgumentSchema, async () => {
    if (process.env.E2E_USE_FIXTURES === '1' && process.env.ELECTRON_TEST_DIRECTORY) {
      return path.resolve(process.env.ELECTRON_TEST_DIRECTORY);
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select session directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  registerIpcHandler(CHANNELS.SELECT_EXECUTABLE, executableSchema, async executable => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${executable} executable`,
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  registerIpcHandler(CHANNELS.GET_SETTINGS, noArgumentSchema, async () => settingsStore.get());
  registerIpcHandler(CHANNELS.UPDATE_SETTINGS, settingsPatchSchema, async patch => {
    const updated = await settingsStore.update(patch);
    updater?.applySettings(updated);
    return {
      ...updated,
      restartRequired: patch.telemetryEnabled !== undefined || patch.executablePaths !== undefined
    };
  });
  registerIpcHandler(CHANNELS.OPEN_LOGS, noArgumentSchema, async () => {
    const error = await shell.openPath(app.getPath('logs'));
    if (error) throw new Error(error);
    return true;
  });
  registerIpcHandler(CHANNELS.EXPORT_DIAGNOSTICS, noArgumentSchema, async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export sanitized diagnostics',
      defaultPath: `copilot-session-viewer-diagnostics-${Date.now()}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return exportDiagnostics({
      logsDirectory: app.getPath('logs'),
      destination: result.filePath,
      appVersion: app.getVersion()
    });
  });
  registerIpcHandler(CHANNELS.EXPORT_SESSION, exportSessionSchema, exportSession);
  registerIpcHandler(
    CHANNELS.CHECK_FOR_UPDATES,
    noArgumentSchema,
    async () => updater.checkForUpdates()
  );
  registerIpcHandler(CHANNELS.MINIMIZE_WINDOW, noArgumentSchema, async () => {
    mainWindow.minimize();
    return true;
  });
  registerIpcHandler(CHANNELS.TOGGLE_MAXIMIZE_WINDOW, noArgumentSchema, async () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return getWindowState();
  });
  registerIpcHandler(CHANNELS.CLOSE_WINDOW, noArgumentSchema, async () => {
    mainWindow.close();
    return true;
  });
  registerIpcHandler(CHANNELS.GET_WINDOW_STATE, noArgumentSchema, async () => getWindowState());
  registerIpcHandler(
    CHANNELS.GET_MENU_MODEL,
    noArgumentSchema,
    async () => getMenuModel(process.platform, app.isPackaged)
  );
  registerIpcHandler(
    CHANNELS.EXECUTE_MENU_COMMAND,
    menuCommandSchema,
    async commandId => executeMenuCommand(commandId)
  );
  registerIpcHandler(CHANNELS.SHELL_READY, shellStatusSchema, async status => {
    const properties = {
      frameStyle: process.platform === 'darwin' ? 'native-inset' : 'custom'
    };
    if (status.status === 'ready') {
      rendererShellReady = true;
      logger.info('desktop-shell.initialized', properties);
      dispatchPendingAddDirectory();
    } else {
      rendererShellReady = false;
      logger.error('desktop-shell.initialization-failed', {
        ...properties,
        stage: status.stage
      });
    }
    return true;
  });
  registerIpcHandler(CHANNELS.DIALOG_HOST_READY, noArgumentSchema, async (_argument, _id, event) => {
    dialogCoordinator.markReady(event.sender);
    logger.info('dialog.host-ready');
    return true;
  });
  registerIpcHandler(
    CHANNELS.DIALOG_RESPONSE,
    dialogResponseSchema,
    async (response, _id, event) => dialogCoordinator.resolve(event.sender, response)
  );
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(serverRecoveryResetTimer);
  logger?.info('app.shutdown.started');
  try {
    const processManager = require('../src/server/utils/processManager');
    await processManager.killAll();
    await serverHandle?.close();
  } catch (error) {
    logger?.error('app.shutdown.failed', { error });
  }
  await Promise.race([
    Promise.allSettled([
      logger?.flush(),
      require('../src/server/telemetry').flush()
    ]),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
}

async function bootstrap() {
  logger = await initializeLogger({
    directory: app.getPath('logs'),
    component: 'electron-main',
    version: app.getVersion()
  });
  logger.info('app.startup', { packaged: app.isPackaged });

  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), { logger });
  const settings = await settingsStore.load();
  configureEnvironment(settings);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event, item) => {
    let downloadUrl;
    try {
      downloadUrl = new URL(item.getURL());
    } catch (error) {
      event.preventDefault();
      logger.warn('download.rejected', { error });
      return;
    }
    if (downloadUrl.origin !== appOrigin
      || !/^\/api\/[^/]+\/sessions\/[^/]+\/export$/.test(downloadUrl.pathname)) {
      event.preventDefault();
      logger.warn('download.rejected', { path: downloadUrl.pathname });
      return;
    }

    item.pause();
    dialog.showSaveDialog(mainWindow, {
      title: 'Export session',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename())
    }).then(result => {
      if (result.canceled || !result.filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(result.filePath);
      item.resume();
    }).catch(error => {
      logger.error('download.failed', { error });
      item.cancel();
    });
  });

  serverHandle = await startEmbeddedServer();
  dialogCoordinator = new RendererDialogCoordinator({
    getWindow: () => mainWindow,
    logger
  });
  registerIpcHandlers();
  updater = createUpdater({
    app,
    logger,
    settings,
    getWindow: () => mainWindow,
    showDialog: descriptor => showApplicationDialog(descriptor)
  });
  await createMainWindow();
  buildApplicationMenu();
  if (process.platform === 'win32') {
    const result = app.setJumpList(createWindowsJumpList({
      executablePath: process.execPath,
      iconPath: path.join(__dirname, 'assets', 'icon.ico')
    }));
    logger.info('jump-list.configured', { result });
  }
  setTimeout(() => {
    updater.checkForUpdates().catch(error => logger.error('updater.startup-check-failed', { error }));
  }, 5000);

  powerMonitor.on('suspend', () => {
    logger.info('power.suspend');
    require('../src/server/utils/processManager').killAll()
      .catch(error => logger.error('child-process.cleanup-failed', { error }));
  });
  powerMonitor.on('resume', () => {
    logger.info('power.resume');
    if (!serverHandle?.server.listening) recoverEmbeddedServer();
  });
  screen.on('display-metrics-changed', sendWindowState);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (hasAddDirectoryArgument(commandLine)) pendingAddDirectory = true;
    activateMainWindow();
    dispatchPendingAddDirectory();
  });

  app.whenReady().then(bootstrap).catch(async error => {
    logger?.error('app.startup.failed', { error });
    await dialog.showMessageBox({
      type: 'error',
      title: 'Copilot Session Viewer failed to start',
      message: 'The desktop application could not start.',
      detail: error.message
    });
    app.quit();
  });
}

app.on('activate', () => {
  if (!mainWindow && serverHandle) {
    createMainWindow().catch(error => logger.error('window.recreate-failed', { error }));
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('child-process-gone', (_event, details) => {
  logger?.error('electron-child.gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode
  });
});
app.on('before-quit', event => {
  if (shuttingDown) return;
  event.preventDefault();
  shutdown().finally(() => app.quit());
});
process.on('uncaughtException', error => {
  logger?.error('process.uncaught-exception', { error });
  if (app.isReady()) {
    dialog.showErrorBox(
      'Copilot Session Viewer stopped unexpectedly',
      'Restart the application. Diagnostic logs contain the correlation and crash details.'
    );
  }
  Promise.race([
    logger?.flush() || Promise.resolve(),
    new Promise(resolve => setTimeout(resolve, 1500))
  ]).finally(() => app.exit(1));
});
process.on('unhandledRejection', reason => {
  logger?.error('process.unhandled-rejection', {
    error: reason instanceof Error ? reason : new Error(String(reason))
  });
});
