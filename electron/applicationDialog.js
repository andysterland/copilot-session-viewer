async function showNativeApplicationDialog(descriptor, { dialog, getWindow }) {
  const buttons = descriptor.buttons.map(button => button.label);
  const defaultId = Math.max(0, descriptor.buttons.findIndex(
    button => button.id === descriptor.defaultId
  ));
  const cancelId = Math.max(0, descriptor.buttons.findIndex(
    button => button.id === descriptor.cancelId
  ));
  const options = {
    type: descriptor.type === 'error'
      ? 'error'
      : descriptor.type === 'warning' || descriptor.type === 'destructive'
        ? 'warning'
        : descriptor.type === 'confirmation'
          ? 'question'
          : 'info',
    title: descriptor.title,
    message: descriptor.message,
    detail: descriptor.detail,
    buttons,
    defaultId,
    cancelId,
    noLink: true
  };
  const window = getWindow();
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return {
    action: descriptor.buttons[result.response]?.id || descriptor.cancelId
  };
}

async function showApplicationDialog(descriptor, {
  coordinator,
  dialog,
  getWindow,
  isShuttingDown,
  logger,
  nativeFallback = true
}) {
  try {
    return await coordinator.show(descriptor);
  } catch (error) {
    logger.warn('dialog.renderer-unavailable', {
      dialogType: descriptor.type,
      error
    });
    if (isShuttingDown()) return { action: descriptor.cancelId };
    if (!nativeFallback) throw error;
    logger.info('dialog.presented', {
      dialogType: descriptor.type,
      source: 'native-fallback'
    });
    const result = await showNativeApplicationDialog(descriptor, { dialog, getWindow });
    logger.info('dialog.result', { resultType: result.action });
    return result;
  }
}

module.exports = {
  showApplicationDialog,
  showNativeApplicationDialog
};
