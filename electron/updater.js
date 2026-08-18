const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

function isProductionRelease(app, resourcesPath = process.resourcesPath) {
  if (!app.isPackaged || !resourcesPath) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(
      path.join(resourcesPath, 'production-release.json'),
      'utf8'
    ));
    return marker.version === app.getVersion()
      && marker.repository === 'andysterland/copilot-session-viewer';
  } catch {
    return false;
  }
}

function createUpdater(options) {
  const { app, getWindow, logger, settings } = options;
  const showDialog = options.showDialog || (async descriptor => {
    const window = getWindow();
    const nativeResult = await options.dialog.showMessageBox(window, {
      type: descriptor.type,
      title: descriptor.title,
      message: descriptor.message,
      detail: descriptor.detail,
      buttons: descriptor.buttons.map(button => button.label),
      defaultId: descriptor.buttons.findIndex(button => button.id === descriptor.defaultId),
      cancelId: descriptor.buttons.findIndex(button => button.id === descriptor.cancelId)
    });
    return { action: descriptor.buttons[nativeResult.response].id };
  });
  const explicitlyDisabled = process.env.ELECTRON_ENABLE_UPDATES === 'false';
  const productionRelease = options.productionRelease
    ?? isProductionRelease(app, options.resourcesPath);
  const enabled = !explicitlyDisabled && productionRelease;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = settings.updateChannel === 'prerelease';
  autoUpdater.channel = settings.updateChannel === 'prerelease' ? 'beta' : 'latest';

  const sendStatus = (state, details = {}) => {
    logger.info('updater.state', { state, ...details });
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:update-status', { state, ...details });
    }
  };

  autoUpdater.on('checking-for-update', () => sendStatus('checking'));
  autoUpdater.on('update-not-available', info => sendStatus('not-available', { version: info.version }));
  autoUpdater.on('download-progress', progress => sendStatus('downloading', {
    percent: Math.round(progress.percent)
  }));
  autoUpdater.on('update-downloaded', async info => {
    sendStatus('downloaded', { version: info.version });
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    const result = await showDialog({
      type: 'info',
      title: 'Update ready',
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart now to install the verified update?',
      buttons: [
        { id: 'install', label: 'Restart and Install', role: 'primary' },
        { id: 'later', label: 'Later', role: 'cancel' }
      ],
      defaultId: 'install',
      cancelId: 'later'
    });
    if (result.action === 'install') autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on('error', error => {
    logger.error('updater.failed', { error });
    sendStatus('error', { message: 'Update check failed. The application can continue offline.' });
  });
  autoUpdater.on('update-available', async info => {
    sendStatus('available', { version: info.version });
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    const result = await showDialog({
      type: 'info',
      title: 'Update available',
      message: `Version ${info.version} is available.`,
      detail: 'Download the verified update now?',
      buttons: [
        { id: 'download', label: 'Download', role: 'primary' },
        { id: 'later', label: 'Later', role: 'cancel' }
      ],
      defaultId: 'download',
      cancelId: 'later'
    });
    if (result.action === 'download') {
      await autoUpdater.downloadUpdate();
    }
  });

  async function checkForUpdates() {
    if (!enabled) {
      sendStatus('disabled', {
        message: 'Updates are disabled for unsigned, development, and nightly builds.'
      });
      return { enabled: false };
    }
    await autoUpdater.checkForUpdates();
    return { enabled: true };
  }

  async function installDownloadedUpdate() {
    autoUpdater.quitAndInstall(false, true);
  }

  return {
    checkForUpdates,
    installDownloadedUpdate,
    applySettings(updatedSettings) {
      autoUpdater.allowPrerelease = updatedSettings.updateChannel === 'prerelease';
      autoUpdater.channel = updatedSettings.updateChannel === 'prerelease' ? 'beta' : 'latest';
    }
  };
}

module.exports = {
  createUpdater,
  isProductionRelease
};
