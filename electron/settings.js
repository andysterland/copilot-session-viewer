const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const CURRENT_SETTINGS_VERSION = 1;
const DEFAULT_SETTINGS = Object.freeze({
  version: CURRENT_SETTINGS_VERSION,
  telemetryEnabled: false,
  updateChannel: 'stable',
  executablePaths: {
    copilot: null,
    claude: null,
    pi: null
  },
  window: {
    width: 1280,
    height: 800,
    x: null,
    y: null,
    maximized: false
  }
});

const settingsSchema = z.object({
  version: z.literal(CURRENT_SETTINGS_VERSION),
  telemetryEnabled: z.boolean(),
  updateChannel: z.enum(['stable', 'prerelease']),
  executablePaths: z.object({
    copilot: z.string().nullable(),
    claude: z.string().nullable(),
    pi: z.string().nullable()
  }),
  window: z.object({
    width: z.number().int().positive().max(10000),
    height: z.number().int().positive().max(10000),
    x: z.number().int().nullable(),
    y: z.number().int().nullable(),
    maximized: z.boolean()
  })
});

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function migrateSettings(value) {
  if (!value || typeof value !== 'object') return cloneDefaults();
  if (value.version === CURRENT_SETTINGS_VERSION) return value;

  if (value.version === undefined || value.version === 0) {
    return {
      ...cloneDefaults(),
      telemetryEnabled: value.telemetryEnabled === true,
      executablePaths: {
        ...cloneDefaults().executablePaths,
        ...(value.executablePaths || {})
      },
      window: {
        ...cloneDefaults().window,
        ...(value.window || {})
      }
    };
  }
  throw new Error(`Unsupported desktop settings version: ${value.version}`);
}

/**
 * Versioned atomic settings store owned by the Electron host.
 */
class SettingsStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.logger = options.logger || null;
    this.settings = cloneDefaults();
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      this.settings = settingsSchema.parse(migrateSettings(JSON.parse(raw)));
      return this.get();
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.save(this.settings);
        return this.get();
      }

      const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await fs.promises.copyFile(this.filePath, backupPath);
      } catch (backupError) {
        throw new Error('Desktop settings are invalid and could not be backed up', { cause: backupError });
      }
      this.logger?.error?.('settings.recovered', { error, backupPath });
      this.settings = cloneDefaults();
      await this.save(this.settings);
      return this.get();
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  async update(patch) {
    const next = {
      ...this.settings,
      ...patch,
      version: CURRENT_SETTINGS_VERSION,
      executablePaths: {
        ...this.settings.executablePaths,
        ...(patch.executablePaths || {})
      },
      window: {
        ...this.settings.window,
        ...(patch.window || {})
      }
    };
    return this.save(next);
  }

  async save(value) {
    this.settings = settingsSchema.parse(value);
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.promises.rename(temporaryPath, this.filePath);
    return this.get();
  }
}

module.exports = {
  CURRENT_SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  SettingsStore,
  migrateSettings,
  settingsSchema
};
