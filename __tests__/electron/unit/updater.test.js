const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const mockAutoUpdater = Object.assign(new EventEmitter(), {
  checkForUpdates: jest.fn().mockResolvedValue({}),
  downloadUpdate: jest.fn().mockResolvedValue([]),
  quitAndInstall: jest.fn()
});

jest.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

const { createUpdater, isProductionRelease } = require('../../../electron/updater');

describe('desktop updater', () => {
  const resourcesPath = path.join(__dirname, '..', '..', '.artifacts', 'updater-resources');

  beforeEach(() => {
    jest.clearAllMocks();
    mockAutoUpdater.removeAllListeners();
    delete process.env.ELECTRON_ENABLE_UPDATES;
  });

  afterEach(async () => {
    await fs.promises.rm(resourcesPath, { recursive: true, force: true });
  });

  it('keeps update checks disabled for development builds by default', async () => {
    const updater = createUpdater({
      app: { isPackaged: false },
      dialog: { showMessageBox: jest.fn() },
      logger: { info: jest.fn(), error: jest.fn() },
      settings: { updateChannel: 'stable' },
      getWindow: () => null,
      productionRelease: false
    });

    await expect(updater.checkForUpdates()).resolves.toEqual({ enabled: false });
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('checks the configured prerelease channel for marked production releases', async () => {
    const updater = createUpdater({
      app: { isPackaged: true },
      dialog: { showMessageBox: jest.fn() },
      logger: { info: jest.fn(), error: jest.fn() },
      settings: { updateChannel: 'prerelease' },
      getWindow: () => null,
      productionRelease: true
    });

    await expect(updater.checkForUpdates()).resolves.toEqual({ enabled: true });
    expect(mockAutoUpdater.allowPrerelease).toBe(true);
    expect(mockAutoUpdater.channel).toBe('beta');
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
  });

  it('contains updater failures and reports a recoverable state', () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    createUpdater({
      app: { isPackaged: true },
      dialog: { showMessageBox: jest.fn() },
      logger,
      settings: { updateChannel: 'stable' },
      getWindow: () => null,
      productionRelease: true
    });
    mockAutoUpdater.emit('error', new Error('offline'));
    expect(logger.error).toHaveBeenCalledWith('updater.failed', expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith('updater.state', expect.objectContaining({
      state: 'error'
    }));
  });

  it('does not install a downloaded update when the user chooses Later', async () => {
    const dialog = { showMessageBox: jest.fn().mockResolvedValue({ response: 1 }) };
    createUpdater({
      app: { isPackaged: true },
      dialog,
      logger: { info: jest.fn(), error: jest.fn() },
      settings: { updateChannel: 'stable' },
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: { send: jest.fn() }
      }),
      productionRelease: true
    });

    mockAutoUpdater.emit('update-downloaded', { version: '1.2.3' });
    await new Promise(resolve => setImmediate(resolve));

    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('uses the renderer dialog coordinator for normal update confirmations', async () => {
    const showDialog = jest.fn().mockResolvedValue({ action: 'download' });
    createUpdater({
      app: { isPackaged: true },
      showDialog,
      logger: { info: jest.fn(), error: jest.fn() },
      settings: { updateChannel: 'stable' },
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: { send: jest.fn() }
      }),
      productionRelease: true
    });

    mockAutoUpdater.emit('update-available', { version: '1.2.3' });
    await new Promise(resolve => setImmediate(resolve));

    expect(showDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Update available',
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'download' })
      ])
    }));
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();
  });

  it('requires a matching production-release marker', async () => {
    const app = { isPackaged: true, getVersion: () => '1.2.3' };
    await fs.promises.mkdir(resourcesPath, { recursive: true });
    await fs.promises.writeFile(
      path.join(resourcesPath, 'production-release.json'),
      JSON.stringify({
        version: '1.2.3',
        repository: 'andysterland/copilot-session-viewer'
      })
    );

    expect(isProductionRelease(app, resourcesPath)).toBe(true);
    await fs.promises.writeFile(
      path.join(resourcesPath, 'production-release.json'),
      JSON.stringify({
        version: '1.2.2',
        repository: 'andysterland/copilot-session-viewer'
      })
    );
    expect(isProductionRelease(app, resourcesPath)).toBe(false);
  });
});
