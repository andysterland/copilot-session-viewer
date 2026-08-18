const {
  configureNativeMenuVisibility,
  createWindowOptions,
  getVisibleWindowBounds,
  WINDOW_BACKGROUND
} = require('../../../electron/windowConfig');
const { isWindowIndependentCommand } = require('../../../electron/menuCommands');

describe('platform-specific desktop window configuration', () => {
  it('uses a themed frameless resizable shell on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      const options = createWindowOptions({
        platform,
        bounds: { width: 1200, height: 800 },
        preloadPath: 'preload.js',
        iconPath: 'icon.ico',
        packaged: true
      });
      expect(options).toEqual(expect.objectContaining({
        autoHideMenuBar: false,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: WINDOW_BACKGROUND,
        minWidth: 800,
        minHeight: 600,
        resizable: true,
        maximizable: true,
        hasShadow: true,
        icon: 'icon.ico'
      }));
      expect(options.webPreferences).toEqual(expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false
      }));
    }
  });

  it('keeps native macOS traffic lights in an inset themed title region', () => {
    const options = createWindowOptions({ platform: 'darwin' });
    expect(options).toEqual(expect.objectContaining({
      frame: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 11 },
      backgroundColor: WINDOW_BACKGROUND
    }));
  });

  it('clamps restored bounds and size to the matching display work area', () => {
    const displayProvider = {
      getDisplayMatching: jest.fn(() => ({
        workArea: { x: -1920, y: 24, width: 1920, height: 1056 }
      }))
    };

    expect(getVisibleWindowBounds({
      x: -2500,
      y: -200,
      width: 3000,
      height: 1400
    }, displayProvider)).toEqual({
      x: -1920,
      y: 24,
      width: 1920,
      height: 1056
    });
  });

  it('moves off-screen restored windows fully into the nearest work area', () => {
    const displayProvider = {
      getDisplayMatching: jest.fn(() => ({
        workArea: { x: 0, y: 0, width: 1366, height: 728 }
      }))
    };

    expect(getVisibleWindowBounds({
      x: 4000,
      y: 2000,
      width: 1000,
      height: 700
    }, displayProvider)).toEqual({
      x: 366,
      y: 28,
      width: 1000,
      height: 700
    });
  });

  it('clamps default size to the primary work area without forcing a position', () => {
    const displayProvider = {
      getPrimaryDisplay: jest.fn(() => ({
        workArea: { x: 0, y: 0, width: 700, height: 500 }
      }))
    };

    const bounds = getVisibleWindowBounds({ width: 1280, height: 800 }, displayProvider);
    expect(bounds).toEqual({ width: 700, height: 500 });
    expect(createWindowOptions({ bounds })).toEqual(expect.objectContaining({
      minWidth: 700,
      minHeight: 500
    }));
  });

  it('keeps the native menu hidden without auto-hide activation on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      const window = {
        setAutoHideMenuBar: jest.fn(),
        setMenuBarVisibility: jest.fn()
      };
      configureNativeMenuVisibility(window, platform);
      expect(window.setAutoHideMenuBar).toHaveBeenCalledWith(false);
      expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false);
    }
  });

  it('leaves the native macOS menu alone and classifies window-independent commands', () => {
    const window = {
      setAutoHideMenuBar: jest.fn(),
      setMenuBarVisibility: jest.fn()
    };
    configureNativeMenuVisibility(window, 'darwin');
    expect(window.setAutoHideMenuBar).not.toHaveBeenCalled();
    expect(window.setMenuBarVisibility).not.toHaveBeenCalled();
    expect(isWindowIndependentCommand('help.about')).toBe(true);
    expect(isWindowIndependentCommand('help.check-updates')).toBe(true);
    expect(isWindowIndependentCommand('view.reload')).toBe(false);
  });
});
