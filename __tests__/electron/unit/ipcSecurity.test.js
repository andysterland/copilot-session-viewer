const fs = require('fs');
const path = require('path');
const {
  dialogCancellationSchema,
  dialogDescriptorSchema,
  dialogResponseSchema,
  executableSchema,
  exportSessionSchema,
  isTrustedSender,
  menuCommandSchema,
  noArgumentSchema,
  shellStatusSchema,
  settingsPatchSchema
} = require('../../../electron/ipc');

describe('preload and IPC security', () => {
  it('validates IPC arguments with explicit schemas', () => {
    expect(executableSchema.parse('copilot')).toBe('copilot');
    expect(() => executableSchema.parse('../arbitrary')).toThrow();
    expect(settingsPatchSchema.parse({ telemetryEnabled: true })).toEqual({
      telemetryEnabled: true
    });
    expect(() => settingsPatchSchema.parse({ arbitraryChannel: true })).toThrow();
    expect(noArgumentSchema.parse(undefined)).toBeUndefined();
    expect(() => noArgumentSchema.parse({})).toThrow();
    expect(shellStatusSchema.parse({ status: 'failed', stage: 'initialization' })).toEqual({
      status: 'failed',
      stage: 'initialization'
    });
    expect(menuCommandSchema.parse('view.zoom-in')).toBe('view.zoom-in');
    expect(() => menuCommandSchema.parse('shell.execute-anything')).toThrow();
    expect(exportSessionSchema.parse({
      source: 'copilot-cli',
      sessionId: 'session-demo'
    })).toEqual({
      source: 'copilot-cli',
      sessionId: 'session-demo'
    });
    expect(() => exportSessionSchema.parse({
      source: 'copilot-cli',
      sessionId: '../session'
    })).toThrow();
  });

  it('validates text-only dialog descriptors and correlated responses', () => {
    expect(dialogDescriptorSchema.parse({
      type: 'prompt',
      title: 'Path',
      message: 'Enter a path.',
      input: {},
      buttons: [
        { id: 'save', label: 'Save', role: 'primary' },
        { id: 'cancel', label: 'Cancel', role: 'cancel' }
      ],
      defaultId: 'save',
      cancelId: 'cancel'
    }).type).toBe('prompt');
    expect(() => dialogDescriptorSchema.parse({
      type: 'info',
      title: 'Unsafe',
      message: 'No callbacks',
      buttons: [{ id: 'ok', label: 'OK', callback: 'execute()' }],
      defaultId: 'ok',
      cancelId: 'ok'
    })).toThrow();
    expect(() => dialogResponseSchema.parse({
      requestId: 'not-a-uuid',
      action: 'ok'
    })).toThrow();
    expect(dialogCancellationSchema.parse({
      requestId: '93dfaf63-aa11-43d3-8d31-a271dd93ebd6'
    })).toEqual({
      requestId: '93dfaf63-aa11-43d3-8d31-a271dd93ebd6'
    });
    expect(() => dialogCancellationSchema.parse({
      requestId: 'not-a-uuid',
      extra: true
    })).toThrow();
  });

  it('requires the expected origin, WebContents, and main frame', () => {
    const mainFrame = { url: 'http://127.0.0.1:3838/' };
    const webContents = { mainFrame };
    const trusted = {
      sender: webContents,
      senderFrame: mainFrame
    };
    expect(isTrustedSender(trusted, 'http://127.0.0.1:3838', webContents)).toBe(true);
    expect(isTrustedSender(
      { ...trusted, senderFrame: { url: 'https://example.com/' } },
      'http://127.0.0.1:3838',
      webContents
    )).toBe(false);
  });

  it('does not expose generic IPC, Node.js, process, or filesystem APIs', () => {
    const preload = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'electron', 'preload.js'), 'utf8');
    expect(preload).toContain("contextBridge.exposeInMainWorld('copilotSessionViewer'");
    expect(preload).not.toContain('ipcRenderer.send(');
    expect(preload).not.toContain("require('fs')");
    expect(preload).not.toContain('process.');
    expect(preload).not.toContain('exposeInMainWorld(\'electron\'');
  });
});
