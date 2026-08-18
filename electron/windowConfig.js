const path = require('path');

const WINDOW_BACKGROUND = '#0d1117';
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Clamps restored bounds to the matching display's usable work area.
 */
function getVisibleWindowBounds(savedWindow = {}, displayProvider) {
  const requestedWidth = Math.max(MIN_WINDOW_WIDTH, savedWindow.width || 1280);
  const requestedHeight = Math.max(MIN_WINDOW_HEIGHT, savedWindow.height || 800);
  const hasPosition = Number.isFinite(savedWindow.x) && Number.isFinite(savedWindow.y);
  const candidate = {
    x: hasPosition ? savedWindow.x : 0,
    y: hasPosition ? savedWindow.y : 0,
    width: requestedWidth,
    height: requestedHeight
  };
  const display = hasPosition
    ? displayProvider?.getDisplayMatching(candidate)
    : displayProvider?.getPrimaryDisplay();
  const area = display?.workArea;

  if (!area || area.width <= 0 || area.height <= 0) {
    return hasPosition
      ? candidate
      : { width: requestedWidth, height: requestedHeight };
  }

  const width = Math.min(requestedWidth, area.width);
  const height = Math.min(requestedHeight, area.height);
  if (!hasPosition) return { width, height };

  return {
    x: clamp(savedWindow.x, area.x, area.x + area.width - width),
    y: clamp(savedWindow.y, area.y, area.y + area.height - height),
    width,
    height
  };
}

function configureNativeMenuVisibility(window, platform = process.platform) {
  if (platform === 'darwin') return;
  window.setAutoHideMenuBar(false);
  window.setMenuBarVisibility(false);
}

/**
 * Builds the platform-specific BrowserWindow options without depending on Electron.
 */
function createWindowOptions({
  platform = process.platform,
  bounds = {},
  preloadPath = path.join(__dirname, 'preload.js'),
  iconPath,
  packaged = false
} = {}) {
  const options = {
    ...bounds,
    minWidth: Math.min(MIN_WINDOW_WIDTH, bounds.width || MIN_WINDOW_WIDTH),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, bounds.height || MIN_WINDOW_HEIGHT),
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    fullscreenable: true,
    hasShadow: true,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'Copilot Session Viewer',
    autoHideMenuBar: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: !packaged
    }
  };
  if (iconPath) options.icon = iconPath;

  if (platform === 'darwin') {
    return {
      ...options,
      frame: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 11 }
    };
  }

  return {
    ...options,
    frame: false,
    titleBarStyle: 'hidden',
    thickFrame: platform === 'win32'
  };
}

module.exports = {
  configureNativeMenuVisibility,
  getVisibleWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_BACKGROUND,
  createWindowOptions
};
