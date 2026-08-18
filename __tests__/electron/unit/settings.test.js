const fs = require('fs');
const path = require('path');
const {
  CURRENT_SETTINGS_VERSION,
  SettingsStore,
  migrateSettings
} = require('../../../electron/settings');

describe('desktop settings', () => {
  const root = path.join(__dirname, '..', '..', '.artifacts', 'settings');
  const settingsPath = path.join(root, 'settings.json');

  beforeEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('defaults telemetry to disabled and persists versioned settings', async () => {
    const store = new SettingsStore(settingsPath);
    const settings = await store.load();
    expect(settings.telemetryEnabled).toBe(false);
    expect(settings.version).toBe(CURRENT_SETTINGS_VERSION);

    await store.update({ telemetryEnabled: true });
    const reloaded = new SettingsStore(settingsPath);
    expect((await reloaded.load()).telemetryEnabled).toBe(true);
  });

  it('migrates unversioned settings', () => {
    expect(migrateSettings({
      telemetryEnabled: true,
      executablePaths: { copilot: 'configured-copilot' }
    })).toMatchObject({
      version: CURRENT_SETTINGS_VERSION,
      telemetryEnabled: true,
      executablePaths: { copilot: 'configured-copilot' }
    });
  });

  it('backs up corrupt settings before recovering defaults', async () => {
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(settingsPath, '{broken json', 'utf8');
    const logger = { error: jest.fn() };
    const store = new SettingsStore(settingsPath, { logger });

    expect((await store.load()).telemetryEnabled).toBe(false);
    const files = await fs.promises.readdir(root);
    expect(files.some(file => file.startsWith('settings.json.corrupt-'))).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('settings.recovered', expect.any(Object));
  });
});
