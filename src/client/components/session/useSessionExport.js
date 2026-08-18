/**
 * Session export composable — download session as zip.
 */
import { ref } from 'vue';
import { showErrorDialog } from '../desktop/dialogService.js';
import { getDesktopBridge } from '../../utils/desktopBridge.js';

export function useSessionExport(sessionId, source) {
  const exporting = ref(false);

  const exportSession = async () => {
    exporting.value = true;
    try {
      const desktopBridge = getDesktopBridge();
      if (desktopBridge) {
        await desktopBridge.exportSession({
          source: source.value,
          sessionId: sessionId.value
        });
        return;
      }

      const response = await fetch(`/api/${encodeURIComponent(source.value)}/sessions/${sessionId.value}/export`);
      if (!response.ok) throw new Error('Share failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${sessionId.value}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      await showErrorDialog({
        title: 'Session export failed',
        message: 'Failed to export the session.',
        detail: err.message
      });
    } finally {
      exporting.value = false;
    }
  };

  return {
    exporting,
    exportSession
  };
}
