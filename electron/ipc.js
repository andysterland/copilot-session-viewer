const { z } = require('zod');
const { MENU_COMMAND_IDS } = require('./menuCommands');

const CHANNELS = Object.freeze({
  SELECT_DIRECTORY: 'desktop:select-directory',
  SELECT_EXECUTABLE: 'desktop:select-executable',
  GET_SETTINGS: 'desktop:get-settings',
  UPDATE_SETTINGS: 'desktop:update-settings',
  OPEN_LOGS: 'desktop:open-logs',
  EXPORT_DIAGNOSTICS: 'desktop:export-diagnostics',
  EXPORT_SESSION: 'desktop:export-session',
  CHECK_FOR_UPDATES: 'desktop:check-for-updates',
  UPDATE_STATUS: 'desktop:update-status',
  MINIMIZE_WINDOW: 'desktop:minimize-window',
  TOGGLE_MAXIMIZE_WINDOW: 'desktop:toggle-maximize-window',
  CLOSE_WINDOW: 'desktop:close-window',
  GET_WINDOW_STATE: 'desktop:get-window-state',
  WINDOW_STATE_CHANGED: 'desktop:window-state-changed',
  GET_MENU_MODEL: 'desktop:get-menu-model',
  EXECUTE_MENU_COMMAND: 'desktop:execute-menu-command',
  MENU_COMMAND: 'desktop:menu-command',
  SHELL_READY: 'desktop:shell-ready',
  DIALOG_HOST_READY: 'desktop:dialog-host-ready',
  DIALOG_REQUEST: 'desktop:dialog-request',
  DIALOG_CANCEL: 'desktop:dialog-cancel',
  DIALOG_RESPONSE: 'desktop:dialog-response'
});

const noArgumentSchema = z.undefined();
const executableSchema = z.enum(['copilot', 'claude', 'pi']);
const settingsPatchSchema = z.object({
  telemetryEnabled: z.boolean().optional(),
  updateChannel: z.enum(['stable', 'prerelease']).optional(),
  executablePaths: z.object({
    copilot: z.string().nullable().optional(),
    claude: z.string().nullable().optional(),
    pi: z.string().nullable().optional()
  }).partial().optional()
}).strict();
const menuCommandSchema = z.enum(MENU_COMMAND_IDS);
const exportSessionSchema = z.object({
  source: z.enum(['copilot-cli', 'copilot-chat', 'claude', 'modernize', 'pi-mono']),
  sessionId: z.string().min(1).max(255).regex(/^[a-zA-Z0-9_-]+$/)
}).strict();
const shellStatusSchema = z.object({
  status: z.enum(['ready', 'failed']),
  stage: z.enum(['initialization']).optional()
}).strict();
const windowStateSchema = z.object({
  maximized: z.boolean(),
  minimized: z.boolean(),
  focused: z.boolean(),
  fullScreen: z.boolean(),
  scaleFactor: z.number().positive(),
  platform: z.enum(['win32', 'linux', 'darwin'])
}).strict();
/**
 * Text-only dialog IPC contracts. Descriptors cannot carry HTML or executable callbacks.
 */
const dialogButtonSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  role: z.enum(['primary', 'secondary', 'cancel', 'destructive']).optional()
}).strict();
const dialogDescriptorSchema = z.object({
  type: z.enum(['info', 'warning', 'error', 'confirmation', 'destructive', 'prompt']),
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2000),
  detail: z.string().max(4000).optional(),
  buttons: z.array(dialogButtonSchema).min(1).max(4),
  defaultId: z.string().min(1).max(64),
  cancelId: z.string().min(1).max(64),
  input: z.object({
    label: z.string().max(160).optional(),
    value: z.string().max(4000).optional(),
    placeholder: z.string().max(240).optional()
  }).strict().optional()
}).strict().superRefine((descriptor, context) => {
  const ids = new Set(descriptor.buttons.map(button => button.id));
  if (!ids.has(descriptor.defaultId)) {
    context.addIssue({ code: 'custom', message: 'defaultId must match a dialog button' });
  }
  if (!ids.has(descriptor.cancelId)) {
    context.addIssue({ code: 'custom', message: 'cancelId must match a dialog button' });
  }
  if (descriptor.type === 'prompt' && !descriptor.input) {
    context.addIssue({ code: 'custom', message: 'Prompt dialogs require input options' });
  }
});
const dialogRequestSchema = z.object({
  requestId: z.uuid(),
  descriptor: dialogDescriptorSchema
}).strict();
const dialogCancellationSchema = z.object({
  requestId: z.uuid()
}).strict();
const dialogResponseSchema = z.object({
  requestId: z.uuid(),
  action: z.string().min(1).max(64),
  value: z.string().max(4000).optional()
}).strict();
const updateStatusSchema = z.object({
  state: z.string().min(1).max(64),
  message: z.string().max(500).optional(),
  version: z.string().max(64).optional(),
  percent: z.number().min(0).max(100).optional()
}).passthrough();

function isTrustedSender(event, expectedOrigin, expectedWebContents) {
  try {
    const senderUrl = new URL(event.senderFrame.url);
    return senderUrl.origin === expectedOrigin
      && event.sender === expectedWebContents
      && event.senderFrame === expectedWebContents.mainFrame;
  } catch {
    return false;
  }
}

module.exports = {
  CHANNELS,
  dialogCancellationSchema,
  dialogDescriptorSchema,
  dialogRequestSchema,
  dialogResponseSchema,
  executableSchema,
  exportSessionSchema,
  isTrustedSender,
  menuCommandSchema,
  noArgumentSchema,
  shellStatusSchema,
  settingsPatchSchema,
  updateStatusSchema,
  windowStateSchema
};
