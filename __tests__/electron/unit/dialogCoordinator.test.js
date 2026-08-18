const { RendererDialogCoordinator } = require('../../../electron/dialogCoordinator');

function descriptor() {
  return {
    type: 'confirmation',
    title: 'Continue?',
    message: 'Choose an action.',
    buttons: [
      { id: 'continue', label: 'Continue', role: 'primary' },
      { id: 'cancel', label: 'Cancel', role: 'cancel' }
    ],
    defaultId: 'continue',
    cancelId: 'cancel'
  };
}

describe('renderer dialog coordination', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('requires a healthy registered renderer and validates result actions', async () => {
    const webContents = {
      isDestroyed: () => false,
      send: jest.fn(),
      mainFrame: {}
    };
    const window = {
      isDestroyed: () => false,
      webContents
    };
    const logger = { info: jest.fn() };
    const coordinator = new RendererDialogCoordinator({
      getWindow: () => window,
      logger,
      timeoutMs: 1000
    });
    coordinator.markReady(webContents);

    const resultPromise = coordinator.show(descriptor());
    const request = webContents.send.mock.calls[0][1];
    expect(webContents.send).toHaveBeenCalledWith(
      'desktop:dialog-request',
      expect.objectContaining({ descriptor: expect.objectContaining({ type: 'confirmation' }) })
    );
    expect(() => coordinator.resolve(webContents, {
      requestId: request.requestId,
      action: 'arbitrary'
    })).toThrow('not allowed');
    expect(coordinator.resolve(webContents, {
      requestId: request.requestId,
      action: 'continue'
    })).toBe(true);
    await expect(resultPromise).resolves.toEqual({
      action: 'continue',
      value: undefined
    });
    expect(logger.info).toHaveBeenCalledWith('dialog.result', expect.objectContaining({
      resultType: 'continue'
    }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Choose an action');
  });

  it('rejects requests when the renderer is unavailable', async () => {
    const coordinator = new RendererDialogCoordinator({
      getWindow: () => null,
      logger: { info: jest.fn() }
    });
    await expect(coordinator.show(descriptor())).rejects.toThrow('unavailable');
  });

  it('cancels the correlated renderer dialog before rejecting a timeout', async () => {
    jest.useFakeTimers();
    const webContents = {
      isDestroyed: () => false,
      send: jest.fn(),
      mainFrame: {}
    };
    const window = {
      isDestroyed: () => false,
      webContents
    };
    const coordinator = new RendererDialogCoordinator({
      getWindow: () => window,
      logger: { info: jest.fn(), warn: jest.fn() },
      timeoutMs: 25
    });
    coordinator.markReady(webContents);

    const resultPromise = coordinator.show(descriptor());
    const request = webContents.send.mock.calls[0][1];
    const rejection = expect(resultPromise).rejects.toThrow('timed out');
    jest.advanceTimersByTime(25);

    expect(webContents.send).toHaveBeenNthCalledWith(
      2,
      'desktop:dialog-cancel',
      { requestId: request.requestId }
    );
    await rejection;
  });
});
