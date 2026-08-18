const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_ENV = {
  copilot: 'COPILOT_CLI_PATH',
  claude: 'CLAUDE_CLI_PATH',
  pi: 'PI_CLI_PATH'
};

function getExecutableExtensions(platform, env) {
  if (platform !== 'win32') return [''];
  return (env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean)
    .map(extension => extension.toLowerCase());
}

function getSearchDirectories(env, platform) {
  const directories = (env.PATH || '').split(path.delimiter).filter(Boolean);
  if (platform === 'darwin') {
    directories.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.npm-global', 'bin')
    );
  }
  return [...new Set(directories.map(directory => path.resolve(directory)))];
}

async function isExecutable(candidate, platform) {
  try {
    const stat = await fs.promises.stat(candidate);
    if (!stat.isFile()) return false;
    await fs.promises.access(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeShimRelativePath(relativePath) {
  return relativePath
    .replace(/^[/\\]+/, '')
    .replaceAll('\\', path.sep)
    .replaceAll('/', path.sep);
}

/**
 * Resolve configured AI CLI executables without invoking a shell.
 */
class ExecutableResolver {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.platform = options.platform || process.platform;
    this.configuredPaths = options.configuredPaths || {};
    this.nodeExecutable = options.nodeExecutable;
  }

  /**
   * @param {'copilot'|'claude'|'pi'} executable CLI identifier
   * @returns {Promise<string>} absolute executable path
   */
  async resolve(executable) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG_ENV, executable)) {
      throw new Error(`Unsupported executable: ${executable}`);
    }

    const configured = this.configuredPaths[executable] || this.env[CONFIG_ENV[executable]];
    if (configured) {
      const candidate = path.resolve(configured);
      if (await isExecutable(candidate, this.platform)) return candidate;
      throw new Error(`Configured ${executable} executable is not a runnable file: ${candidate}`);
    }

    const extensions = getExecutableExtensions(this.platform, this.env);
    for (const directory of getSearchDirectories(this.env, this.platform)) {
      const hasExtension = path.extname(executable) !== '';
      const names = hasExtension ? [executable] : extensions.map(extension => `${executable}${extension}`);
      for (const name of names) {
        const candidate = path.join(directory, name);
        if (await isExecutable(candidate, this.platform)) return candidate;
      }
    }

    const configName = CONFIG_ENV[executable];
    throw new Error(
      `${executable} CLI was not found. Install it, add it to PATH, or configure ${configName} in Desktop Settings.`
    );
  }

  async _findNodeExecutable(shimPath) {
    const candidates = [];
    if (this.nodeExecutable) candidates.push(path.resolve(this.nodeExecutable));
    if (path.basename(process.execPath).toLowerCase() === (this.platform === 'win32' ? 'node.exe' : 'node')) {
      candidates.push(process.execPath);
    }
    candidates.push(path.join(path.dirname(shimPath), 'node.exe'));
    for (const directory of getSearchDirectories(this.env, this.platform)) {
      candidates.push(path.join(directory, this.platform === 'win32' ? 'node.exe' : 'node'));
    }
    for (const candidate of [...new Set(candidates)]) {
      if (await isExecutable(candidate, this.platform)) return candidate;
    }
    throw new Error(`The npm shim ${shimPath} requires Node.js, but a Node executable was not found`);
  }

  async _resolveWindowsShim(shimPath) {
    let contents;
    try {
      contents = await fs.promises.readFile(shimPath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read Windows command shim: ${shimPath}`, { cause: error });
    }

    const matches = [];
    const patterns = [
      /["'](?:%~dp0|%dp0%)[\\/]?([^"']+\.(?:cjs|mjs|js))["']/gi,
      /(?:%~dp0|%dp0%)[\\/]?([^\s"&|<>]+\.(?:cjs|mjs|js))/gi
    ];
    for (const pattern of patterns) {
      for (const match of contents.matchAll(pattern)) matches.push(match[1]);
    }

    for (const relativePath of matches) {
      const entryPoint = path.resolve(
        path.dirname(shimPath),
        normalizeShimRelativePath(relativePath)
      );
      if (await isExecutable(entryPoint, this.platform)) {
        return {
          command: await this._findNodeExecutable(shimPath),
          args: [entryPoint],
          resolvedPath: entryPoint,
          shimPath
        };
      }
    }

    throw new Error(
      `Configured Windows command shim is not a recognized npm Node.js launcher: ${shimPath}`
    );
  }

  /**
   * Resolve a shell-free command and fixed argument prefix.
   * @param {'copilot'|'claude'|'pi'} executable CLI identifier
   * @returns {Promise<{command: string, args: string[], resolvedPath: string, shimPath?: string}>}
   */
  async resolveInvocation(executable) {
    const resolvedPath = await this.resolve(executable);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (this.platform === 'win32' && ['.cmd', '.bat'].includes(extension)) {
      return this._resolveWindowsShim(resolvedPath);
    }
    if (['.js', '.cjs', '.mjs'].includes(extension)) {
      return {
        command: await this._findNodeExecutable(resolvedPath),
        args: [resolvedPath],
        resolvedPath
      };
    }
    return {
      command: resolvedPath,
      args: [],
      resolvedPath
    };
  }
}

module.exports = {
  CONFIG_ENV,
  ExecutableResolver,
  getSearchDirectories,
  isExecutable,
  normalizeShimRelativePath
};
