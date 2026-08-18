const { EventEmitter } = require('events');

process.env.PROCESS_MANAGER_DISABLE_SIGNAL_HANDLERS = 'true';
const { ProcessManager } = require('../../../src/server/utils/processManager');

function createChild(pid) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    kill: jest.fn()
  });
}

describe('process tree cleanup', () => {
  it('waits for a POSIX process group to exit after SIGTERM', async () => {
    const child = createChild(4321);
    const killProcessGroup = jest.fn((_pid, signal) => {
      child.signalCode = signal;
      child.emit('exit', null, signal);
    });
    const manager = new ProcessManager({
      platform: 'linux',
      killProcessGroup,
      signalHandlers: false,
      gracePeriodMs: 20,
      forcePeriodMs: 20
    });
    manager.register(child, { name: 'analysis', processGroup: true });

    await expect(manager.killAll()).resolves.toEqual({ requested: 1, remaining: 0 });
    expect(killProcessGroup).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(manager.getActiveCount()).toBe(0);
  });

  it('escalates a process group that ignores graceful termination', async () => {
    const child = createChild(8765);
    const killProcessGroup = jest.fn((_pid, signal) => {
      if (signal === 'SIGKILL') {
        child.signalCode = signal;
        child.emit('exit', null, signal);
      }
    });
    const manager = new ProcessManager({
      platform: 'linux',
      killProcessGroup,
      signalHandlers: false,
      gracePeriodMs: 5,
      forcePeriodMs: 20
    });
    manager.register(child, { processGroup: true });

    await manager.killAll();

    expect(killProcessGroup).toHaveBeenNthCalledWith(1, -8765, 'SIGTERM');
    expect(killProcessGroup).toHaveBeenNthCalledWith(2, -8765, 'SIGKILL');
  });

  it('uses taskkill without a shell for Windows process trees', async () => {
    const child = createChild(2468);
    const spawn = jest.fn((_command, args, options) => {
      const killer = new EventEmitter();
      setImmediate(() => {
        if (args.includes('/F')) {
          child.exitCode = 1;
          child.emit('exit', 1);
        }
        killer.emit('close', 0);
      });
      expect(options.shell).toBe(false);
      return killer;
    });
    const manager = new ProcessManager({
      platform: 'win32',
      spawn,
      signalHandlers: false,
      gracePeriodMs: 5,
      forcePeriodMs: 20
    });
    manager.register(child, { name: 'analysis' });

    await manager.killAll();

    expect(spawn.mock.calls[0][1]).toEqual(['/PID', '2468', '/T']);
    expect(spawn.mock.calls[1][1]).toEqual(['/PID', '2468', '/T', '/F']);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
