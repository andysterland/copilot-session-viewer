const { EventEmitter } = require('events');

process.env.PROCESS_MANAGER_DISABLE_SIGNAL_HANDLERS = 'true';
const { ProcessManager } = require('../src/server/utils/processManager');

function createChild(pid, onKill = null) {
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    kill: jest.fn(signal => {
      onKill?.(child, signal);
    })
  });
  return child;
}

describe('ProcessManager', () => {
  let manager;

  beforeEach(() => {
    manager = new ProcessManager({
      platform: 'linux',
      signalHandlers: false,
      gracePeriodMs: 5,
      forcePeriodMs: 10
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes without active processes', () => {
    expect(manager.activeProcesses).toBeInstanceOf(Set);
    expect(manager.getActiveCount()).toBe(0);
    expect(manager.isShuttingDown).toBe(false);
  });

  it('registers metadata and removes a process when it exits', () => {
    const child = createChild(123);
    const metadata = { name: 'test-process' };
    const processInfo = manager.register(child, metadata);

    expect(processInfo).toEqual(expect.objectContaining({
      process: child,
      metadata,
      startTime: expect.any(Number)
    }));
    expect(manager.getActiveCount()).toBe(1);

    child.exitCode = 0;
    child.emit('exit', 0);
    expect(manager.getActiveCount()).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Process exited (test-process)'));
  });

  it('uses the PID in cleanup when no process name is provided', async () => {
    const child = createChild(999, (current, signal) => {
      current.signalCode = signal;
      current.emit('exit', null, signal);
    });
    manager.register(child);

    await expect(manager.killAll()).resolves.toEqual({ requested: 1, remaining: 0 });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Stopping 1 active processes'));
  });

  it('stops every active process and waits for exit', async () => {
    const children = [123, 456].map(pid => createChild(pid, (current, signal) => {
      current.signalCode = signal;
      current.emit('exit', null, signal);
    }));
    children.forEach((child, index) => manager.register(child, { name: `process-${index}` }));

    await manager.killAll();

    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(children[1].kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.getActiveCount()).toBe(0);
  });

  it('escalates a process that ignores SIGTERM', async () => {
    const child = createChild(321, (current, signal) => {
      if (signal === 'SIGKILL') {
        current.signalCode = signal;
        current.emit('exit', null, signal);
      }
    });
    manager.register(child, { name: 'stubborn' });

    await manager.killAll();

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Force stopping 1'));
  });

  it('contains kill errors and reports a process that remains alive', async () => {
    const child = createChild(654);
    child.kill.mockImplementation(() => {
      throw new Error('Kill failed');
    });
    manager.register(child, { name: 'error-process' });

    await expect(manager.killAll()).resolves.toEqual({ requested: 1, remaining: 1 });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to stop error-process'),
      'Kill failed'
    );
    expect(manager.getActiveCount()).toBe(1);
  });

  it('shares one asynchronous cleanup operation across concurrent callers', async () => {
    const child = createChild(777, (current, signal) => {
      current.signalCode = signal;
      current.emit('exit', null, signal);
    });
    manager.register(child);

    const first = manager.killAll();
    const second = manager.killAll();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { requested: 1, remaining: 0 },
      { requested: 1, remaining: 0 }
    ]);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
