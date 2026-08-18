const { showApplicationDialog } = require('../../../electron/applicationDialog');

function descriptor() {
  return {
    type: 'info',
    title: 'About Copilot Session Viewer',
    message: 'Copilot Session Viewer 1.0.0',
    detail: 'A local viewer.',
    buttons: [{ id: 'ok', label: 'OK', role: 'primary' }],
    defaultId: 'ok',
    cancelId: 'ok'
  };
}

describe('application dialog fallback', () => {
  it('uses an unparented native dialog when no renderer window exists', async () => {
    const dialog = {
      showMessageBox: jest.fn().mockResolvedValue({ response: 0 })
    };
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(showApplicationDialog(descriptor(), {
      coordinator: {
        show: jest.fn().mockRejectedValue(new Error('Renderer unavailable'))
      },
      dialog,
      getWindow: () => null,
      isShuttingDown: () => false,
      logger
    })).resolves.toEqual({ action: 'ok' });

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'About Copilot Session Viewer',
      buttons: ['OK']
    }));
  });

  it('does not present a fallback dialog while the app is shutting down', async () => {
    const dialog = { showMessageBox: jest.fn() };

    await expect(showApplicationDialog(descriptor(), {
      coordinator: {
        show: jest.fn().mockRejectedValue(new Error('Renderer unavailable'))
      },
      dialog,
      getWindow: () => null,
      isShuttingDown: () => true,
      logger: { info: jest.fn(), warn: jest.fn() }
    })).resolves.toEqual({ action: 'ok' });

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
