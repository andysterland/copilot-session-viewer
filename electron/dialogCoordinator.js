const crypto = require('crypto');
const {
  CHANNELS,
  dialogCancellationSchema,
  dialogDescriptorSchema,
  dialogResponseSchema
} = require('./ipc');

class RendererDialogCoordinator {
  constructor(options) {
    this.getWindow = options.getWindow;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs || 120000;
    this.readyWebContents = null;
    this.pending = new Map();
  }

  markReady(webContents) {
    this.readyWebContents = webContents;
  }

  markUnavailable() {
    this.readyWebContents = null;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('Renderer dialog host became unavailable'));
    }
    this.pending.clear();
  }

  isReady() {
    const window = this.getWindow();
    return Boolean(
      window
      && !window.isDestroyed()
      && this.readyWebContents
      && !this.readyWebContents.isDestroyed()
      && window.webContents === this.readyWebContents
    );
  }

  /**
   * Sends a validated, text-only dialog descriptor to the healthy renderer.
   */
  show(descriptor) {
    const parsedDescriptor = dialogDescriptorSchema.parse(descriptor);
    if (!this.isReady()) {
      return Promise.reject(new Error('Renderer dialog host is unavailable'));
    }

    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    this.logger.info('dialog.presented', {
      correlationId,
      dialogType: parsedDescriptor.type,
      source: 'renderer'
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const cancellation = dialogCancellationSchema.parse({ requestId });
        try {
          this.readyWebContents.send(CHANNELS.DIALOG_CANCEL, cancellation);
        } catch (error) {
          this.logger.warn?.('dialog.cancel-failed', { correlationId, error });
        }
        reject(new Error('Renderer dialog response timed out'));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        correlationId,
        allowedActions: new Set(parsedDescriptor.buttons.map(button => button.id))
      });
      try {
        this.readyWebContents.send(CHANNELS.DIALOG_REQUEST, {
          requestId,
          descriptor: parsedDescriptor
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error('Renderer dialog request could not be delivered', { cause: error }));
      }
    });
  }

  resolve(sender, response) {
    const parsedResponse = dialogResponseSchema.parse(response);
    if (sender !== this.readyWebContents) {
      throw new Error('Dialog response sender is not authorized');
    }
    const pending = this.pending.get(parsedResponse.requestId);
    if (!pending) throw new Error('Dialog response does not match an active request');
    if (!pending.allowedActions.has(parsedResponse.action)) {
      throw new Error('Dialog response action is not allowed');
    }

    clearTimeout(pending.timer);
    this.pending.delete(parsedResponse.requestId);
    this.logger.info('dialog.result', {
      correlationId: pending.correlationId,
      resultType: parsedResponse.action
    });
    pending.resolve({
      action: parsedResponse.action,
      value: parsedResponse.value
    });
    return true;
  }
}

module.exports = { RendererDialogCoordinator };
