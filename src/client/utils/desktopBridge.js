import { showPromptDialog } from '../components/desktop/dialogService.js';

export function getDesktopBridge() {
  const bridge = globalThis.copilotSessionViewer;
  return bridge?.isDesktop === true ? bridge : null;
}

export async function selectSessionDirectory() {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.selectDirectory();
  return showPromptDialog({
    title: 'Add session directory',
    message: 'Enter an absolute directory path.',
    detail: 'For example: /home/user/sessions or C:\\sessions',
    label: 'Directory path',
    confirmLabel: 'Add Directory'
  });
}
