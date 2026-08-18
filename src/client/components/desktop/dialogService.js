import { shallowRef } from 'vue';

export const activeDialog = shallowRef(null);

const queuedDialogs = [];
let nextDialogId = 0;

function activateNextDialog() {
  activeDialog.value = queuedDialogs.shift() || null;
}

/**
 * Presents a text-only application dialog and resolves with its selected action.
 */
export function showDialog(descriptor, { requestId = null } = {}) {
  return new Promise(resolve => {
    queuedDialogs.push({
      id: `renderer-dialog-${++nextDialogId}`,
      requestId,
      descriptor,
      resolve
    });
    if (!activeDialog.value) activateNextDialog();
  });
}

export function cancelDialogRequest(requestId) {
  if (activeDialog.value?.requestId === requestId) {
    const current = activeDialog.value;
    activeDialog.value = null;
    current.resolve(null);
    activateNextDialog();
    return true;
  }

  const queuedIndex = queuedDialogs.findIndex(dialog => dialog.requestId === requestId);
  if (queuedIndex === -1) return false;
  const [queued] = queuedDialogs.splice(queuedIndex, 1);
  queued.resolve(null);
  return true;
}

export function resolveActiveDialog(action, value) {
  const current = activeDialog.value;
  if (!current) return;
  current.resolve({ action, value });
  activeDialog.value = null;
  activateNextDialog();
}

export function showInformationDialog({ title, message, detail }) {
  return showDialog({
    type: 'info',
    title,
    message,
    detail,
    buttons: [{ id: 'ok', label: 'OK', role: 'primary' }],
    defaultId: 'ok',
    cancelId: 'ok'
  });
}

export function showErrorDialog({ title = 'Something went wrong', message, detail }) {
  return showDialog({
    type: 'error',
    title,
    message,
    detail,
    buttons: [{ id: 'ok', label: 'OK', role: 'primary' }],
    defaultId: 'ok',
    cancelId: 'ok'
  });
}

export async function showConfirmationDialog({
  title,
  message,
  detail,
  destructive = false,
  confirmLabel = destructive ? 'Delete' : 'Continue',
  cancelLabel = 'Cancel'
}) {
  const result = await showDialog({
    type: destructive ? 'destructive' : 'confirmation',
    title,
    message,
    detail,
    buttons: [
      {
        id: 'confirm',
        label: confirmLabel,
        role: destructive ? 'destructive' : 'primary'
      },
      { id: 'cancel', label: cancelLabel, role: 'cancel' }
    ],
    defaultId: 'confirm',
    cancelId: 'cancel'
  });
  return result.action === 'confirm';
}

export async function showPromptDialog({
  title,
  message,
  detail,
  label,
  value = '',
  placeholder = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel'
}) {
  const result = await showDialog({
    type: 'prompt',
    title,
    message,
    detail,
    input: { label, value, placeholder },
    buttons: [
      { id: 'confirm', label: confirmLabel, role: 'primary' },
      { id: 'cancel', label: cancelLabel, role: 'cancel' }
    ],
    defaultId: 'confirm',
    cancelId: 'cancel'
  });
  return result.action === 'confirm' ? result.value ?? '' : null;
}
