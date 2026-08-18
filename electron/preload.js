const { contextBridge, ipcRenderer } = require('electron');
const CHANNELS = Object.freeze({
  SELECT_DIRECTORY: 'desktop:select-directory',
  SELECT_EXECUTABLE: 'desktop:select-executable',
  GET_SETTINGS: 'desktop:get-settings',
  UPDATE_SETTINGS: 'desktop:update-settings',
  OPEN_LOGS: 'desktop:open-logs',
  EXPORT_DIAGNOSTICS: 'desktop:export-diagnostics',
  EXPORT_SESSION: 'desktop:export-session',
  CHECK_FOR_UPDATES: 'desktop:check-for-updates',
  UPDATE_STATUS: 'desktop:update-status',
  MINIMIZE_WINDOW: 'desktop:minimize-window',
  TOGGLE_MAXIMIZE_WINDOW: 'desktop:toggle-maximize-window',
  CLOSE_WINDOW: 'desktop:close-window',
  GET_WINDOW_STATE: 'desktop:get-window-state',
  WINDOW_STATE_CHANGED: 'desktop:window-state-changed',
  GET_MENU_MODEL: 'desktop:get-menu-model',
  EXECUTE_MENU_COMMAND: 'desktop:execute-menu-command',
  MENU_COMMAND: 'desktop:menu-command',
  SHELL_READY: 'desktop:shell-ready',
  DIALOG_HOST_READY: 'desktop:dialog-host-ready',
  DIALOG_REQUEST: 'desktop:dialog-request',
  DIALOG_CANCEL: 'desktop:dialog-cancel',
  DIALOG_RESPONSE: 'desktop:dialog-response'
});
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseWindowState(value) {
  if (!value
    || typeof value.maximized !== 'boolean'
    || typeof value.minimized !== 'boolean'
    || typeof value.focused !== 'boolean'
    || typeof value.fullScreen !== 'boolean'
    || typeof value.scaleFactor !== 'number'
    || !['win32', 'linux', 'darwin'].includes(value.platform)) {
    throw new Error('Invalid window state');
  }
  return value;
}

function parseDialogRequest(value) {
  const descriptor = value?.descriptor;
  const allowedTypes = ['info', 'warning', 'error', 'confirmation', 'destructive', 'prompt'];
  const allowedRoles = ['primary', 'secondary', 'cancel', 'destructive'];
  const buttonIds = new Set(descriptor?.buttons?.map(button => button.id));
  if (typeof value?.requestId !== 'string' || !requestIdPattern.test(value.requestId)
    || !descriptor
    || !allowedTypes.includes(descriptor.type)
    || typeof descriptor.title !== 'string' || descriptor.title.length > 160
    || typeof descriptor.message !== 'string' || descriptor.message.length > 2000
    || (descriptor.detail !== undefined
      && (typeof descriptor.detail !== 'string' || descriptor.detail.length > 4000))
    || !Array.isArray(descriptor.buttons)
    || descriptor.buttons.length < 1 || descriptor.buttons.length > 4
    || descriptor.buttons.some(button => (
      typeof button.id !== 'string'
      || button.id.length < 1 || button.id.length > 64
      || typeof button.label !== 'string'
      || button.label.length < 1 || button.label.length > 80
      || (button.role !== undefined && !allowedRoles.includes(button.role))
    ))
    || !buttonIds.has(descriptor.defaultId)
    || !buttonIds.has(descriptor.cancelId)
    || (descriptor.type === 'prompt' && !descriptor.input)
    || (descriptor.input !== undefined && (
      !descriptor.input
      || typeof descriptor.input !== 'object'
      || Array.isArray(descriptor.input)
      || (descriptor.input.label !== undefined
        && (typeof descriptor.input.label !== 'string'
          || descriptor.input.label.length > 160))
      || (descriptor.input.value !== undefined
        && (typeof descriptor.input.value !== 'string' || descriptor.input.value.length > 4000))
      || (descriptor.input.placeholder !== undefined
        && (typeof descriptor.input.placeholder !== 'string'
          || descriptor.input.placeholder.length > 240))
    ))) {
    throw new Error('Invalid dialog request');
  }
  return value;
}

function parseDialogCancellation(value) {
  if (!value
    || Object.keys(value).length !== 1
    || typeof value.requestId !== 'string'
    || !requestIdPattern.test(value.requestId)) {
    throw new Error('Invalid dialog cancellation');
  }
  return value;
}

function parseMenuModel(value) {
  if (!Array.isArray(value) || value.some(menu => (
    typeof menu.id !== 'string'
    || typeof menu.label !== 'string'
    || typeof menu.mnemonic !== 'string'
    || !Array.isArray(menu.items)
    || menu.items.some(item => item.type !== 'separator' && (
      typeof item.id !== 'string'
      || typeof item.label !== 'string'
      || typeof item.disabled !== 'boolean'
      || !['main', 'renderer'].includes(item.target)
    ))
  ))) {
    throw new Error('Invalid menu model');
  }
  return value;
}

function parseUpdateStatus(value) {
  if (!value || typeof value.state !== 'string') throw new Error('Invalid update status');
  return value;
}

function subscribe(channel, parse, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(parse(payload));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * Narrow desktop API. It intentionally exposes no generic IPC, filesystem,
 * process, or Electron object to the renderer.
 */
const desktopApi = Object.freeze({
  isDesktop: true,
  /** Opens the native directory picker. */
  selectDirectory: () => ipcRenderer.invoke(CHANNELS.SELECT_DIRECTORY),
  /** Opens the native executable picker for an allowlisted CLI. */
  selectExecutable: executable => ipcRenderer.invoke(CHANNELS.SELECT_EXECUTABLE, executable),
  /** Reads versioned desktop settings. */
  getSettings: () => ipcRenderer.invoke(CHANNELS.GET_SETTINGS),
  /** Applies a schema-limited desktop settings patch. */
  updateSettings: patch => ipcRenderer.invoke(CHANNELS.UPDATE_SETTINGS, patch),
  /** Opens the local desktop log directory. */
  openLogs: () => ipcRenderer.invoke(CHANNELS.OPEN_LOGS),
  /** Exports a sanitized diagnostic archive through a native save dialog. */
  exportDiagnostics: () => ipcRenderer.invoke(CHANNELS.EXPORT_DIAGNOSTICS),
  /** Exports one validated local session through a native save dialog. */
  exportSession: request => ipcRenderer.invoke(CHANNELS.EXPORT_SESSION, request),
  /** Starts an update check when this build is eligible. */
  checkForUpdates: () => ipcRenderer.invoke(CHANNELS.CHECK_FOR_UPDATES),
  /** Minimizes the current application window. */
  minimizeWindow: () => ipcRenderer.invoke(CHANNELS.MINIMIZE_WINDOW),
  /** Toggles the current application window between maximized and restored. */
  toggleMaximizeWindow: () => ipcRenderer.invoke(CHANNELS.TOGGLE_MAXIMIZE_WINDOW),
  /** Requests the platform-standard close lifecycle for the current window. */
  closeWindow: () => ipcRenderer.invoke(CHANNELS.CLOSE_WINDOW),
  /** Reads focus, maximize, full-screen, and display-scale state. */
  getWindowState: () => ipcRenderer.invoke(CHANNELS.GET_WINDOW_STATE),
  /** Reads only the current maximize state. */
  isWindowMaximized: async () => (await ipcRenderer.invoke(CHANNELS.GET_WINDOW_STATE)).maximized,
  /** Subscribes to window focus, maximize, full-screen, and display-scale changes. */
  onWindowStateChanged: callback => subscribe(
    CHANNELS.WINDOW_STATE_CHANGED,
    parseWindowState,
    callback
  ),
  /** Subscribes to maximize/restore changes. */
  onWindowMaximizedChanged: callback => subscribe(
    CHANNELS.WINDOW_STATE_CHANGED,
    parseWindowState,
    state => callback(state.maximized)
  ),
  /** Returns renderer-safe menu definitions shared with main-process accelerators. */
  getMenuCommands: async () => parseMenuModel(
    await ipcRenderer.invoke(CHANNELS.GET_MENU_MODEL)
  ),
  /** Executes an allowlisted menu command. */
  executeMenuCommand: commandId => ipcRenderer.invoke(CHANNELS.EXECUTE_MENU_COMMAND, commandId),
  /** Subscribes to renderer-targeted menu commands. */
  onMenuCommand: callback => subscribe(
    CHANNELS.MENU_COMMAND,
    value => {
      if (typeof value !== 'string') throw new Error('Invalid menu command');
      return value;
    },
    callback
  ),
  /** Marks the themed desktop shell ready after Vue has mounted. */
  notifyShellReady: status => ipcRenderer.invoke(
    CHANNELS.SHELL_READY,
    status || { status: 'ready' }
  ),
  /** Marks the renderer dialog host ready to receive validated requests. */
  notifyDialogHostReady: () => ipcRenderer.invoke(CHANNELS.DIALOG_HOST_READY),
  /** Subscribes to validated main-process dialog requests. */
  onDialogRequest: callback => subscribe(CHANNELS.DIALOG_REQUEST, parseDialogRequest, callback),
  /** Removes a correlated renderer dialog before a main-process fallback is shown. */
  onDialogCancel: callback => subscribe(CHANNELS.DIALOG_CANCEL, parseDialogCancellation, callback),
  /** Resolves an active main-process dialog request. */
  respondToDialog: response => ipcRenderer.invoke(CHANNELS.DIALOG_RESPONSE, response),
  /** Subscribes to updater status without exposing IPC primitives. */
  onUpdateStatus: callback => subscribe(CHANNELS.UPDATE_STATUS, parseUpdateStatus, callback)
});

contextBridge.exposeInMainWorld('copilotSessionViewer', desktopApi);
