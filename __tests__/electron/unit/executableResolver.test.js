const fs = require('fs');
const path = require('path');
const { ExecutableResolver } = require('../../../src/server/services/executableResolver');

describe('external CLI executable resolution', () => {
  const root = path.join(__dirname, '..', '..', '.artifacts', 'executables');

  beforeEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.mkdir(root, { recursive: true });
  });

  afterAll(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  async function createExecutable(name) {
    const executable = path.join(root, name);
    await fs.promises.writeFile(executable, 'fixture', { mode: 0o700 });
    await fs.promises.chmod(executable, 0o700);
    return executable;
  }

  it('prefers and validates an explicitly configured executable', async () => {
    const executable = await createExecutable(process.platform === 'win32' ? 'copilot.exe' : 'copilot');
    const resolver = new ExecutableResolver({
      configuredPaths: { copilot: executable }
    });
    await expect(resolver.resolve('copilot')).resolves.toBe(path.resolve(executable));
  });

  it('searches the inherited PATH without using a shell', async () => {
    const executableName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const executable = await createExecutable(executableName);
    const resolver = new ExecutableResolver({
      env: {
        PATH: root,
        PATHEXT: '.EXE'
      }
    });
    await expect(resolver.resolve('claude')).resolves.toBe(executable);
  });

  it('returns actionable guidance for a missing executable', async () => {
    const resolver = new ExecutableResolver({ env: { PATH: '' } });
    await expect(resolver.resolve('pi'))
      .rejects.toThrow('configure PI_CLI_PATH in Desktop Settings');
  });

  it('resolves npm-installed Windows command shims to Node and their JavaScript entry point', async () => {
    const binDirectory = path.join(root, 'npm-bin');
    const packageDirectory = path.join(root, 'node_modules', 'example-cli');
    await fs.promises.mkdir(binDirectory, { recursive: true });
    await fs.promises.mkdir(packageDirectory, { recursive: true });
    const shim = path.join(binDirectory, 'copilot.cmd');
    const entryPoint = path.join(packageDirectory, 'cli.js');
    const nodeExecutable = await createExecutable('node.exe');
    await fs.promises.writeFile(entryPoint, 'console.log("fixture");');
    await fs.promises.writeFile(
      shim,
      '@ECHO off\r\n"%~dp0\\..\\node_modules\\example-cli\\cli.js" %*\r\n'
    );

    const resolver = new ExecutableResolver({
      platform: 'win32',
      configuredPaths: { copilot: shim },
      nodeExecutable
    });

    await expect(resolver.resolveInvocation('copilot')).resolves.toEqual({
      command: nodeExecutable,
      args: [entryPoint],
      resolvedPath: entryPoint,
      shimPath: shim
    });
  });

  it('rejects arbitrary Windows batch files instead of enabling a shell', async () => {
    const shim = await createExecutable('claude.cmd');
    await fs.promises.writeFile(shim, '@echo off\r\ndel C:\\important\\file\r\n');
    const resolver = new ExecutableResolver({
      platform: 'win32',
      configuredPaths: { claude: shim },
      nodeExecutable: process.execPath
    });

    await expect(resolver.resolveInvocation('claude'))
      .rejects.toThrow('not a recognized npm Node.js launcher');
  });
});
