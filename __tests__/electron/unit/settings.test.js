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

  it('persists versioned settings without telemetry configuration', async () => {
    const store = new SettingsStore(settingsPath);
    const settings = await store.load();
    expect(settings.version).toBe(CURRENT_SETTINGS_VERSION);
    expect(settings).not.toHaveProperty('telemetryEnabled');

    await store.update({ updateChannel: 'prerelease' });
    const reloaded = new SettingsStore(settingsPath);
    expect((await reloaded.load()).updateChannel).toBe('prerelease');
  });

  it('removes telemetry configuration when migrating older settings', () => {
    const migrated = migrateSettings({
      version: 1,
      telemetryEnabled: true,
      executablePaths: { copilot: 'configured-copilot' }
    });

    expect(migrated).toMatchObject({
      version: CURRENT_SETTINGS_VERSION,
      executablePaths: { copilot: 'configured-copilot' }
    });
    expect(migrated).not.toHaveProperty('telemetryEnabled');
  });

  it('backs up corrupt settings before recovering defaults', async () => {
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(settingsPath, '{broken json', 'utf8');
    const logger = { error: jest.fn() };
    const store = new SettingsStore(settingsPath, { logger });

    expect((await store.load()).updateChannel).toBe('stable');
    const files = await fs.promises.readdir(root);
    expect(files.some(file => file.startsWith('settings.json.corrupt-'))).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('settings.recovered', expect.any(Object));
  });
});
