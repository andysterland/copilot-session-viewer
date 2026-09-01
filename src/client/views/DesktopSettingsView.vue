<template>
  <div class="desktop-settings-view">
    <header class="desktop-settings-view__header">
      <div>
        <p class="desktop-settings-view__eyebrow">
          Desktop
        </p>
        <h1>Settings</h1>
        <p>Configure desktop integration, updates, diagnostics, and AI CLI executables.</p>
      </div>
      <button class="desktop-settings-view__back" type="button" @click="router.push('/')">
        Back to Sessions
      </button>
    </header>

    <div v-if="loading" class="desktop-settings-view__panel">
      Loading desktop settings...
    </div>

    <template v-else-if="settings">
      <section class="desktop-settings-view__panel">
        <h2>Updates</h2>
        <label class="desktop-settings-view__field">
          <span>
            <strong>Update channel</strong>
            <small>Choose stable releases or prerelease builds.</small>
          </span>
          <select v-model="settings.updateChannel" @change="saveSettings">
            <option value="stable">Stable</option>
            <option value="prerelease">Prerelease</option>
          </select>
        </label>
      </section>

      <section class="desktop-settings-view__panel">
        <h2>AI CLI executables</h2>
        <p class="desktop-settings-view__description">
          Explicit paths override executable discovery through PATH.
        </p>
        <div
          v-for="executable in executables"
          :key="executable"
          class="desktop-settings-view__executable"
        >
          <div>
            <strong class="capitalize">{{ executable }}</strong>
            <code>{{ settings.executablePaths[executable] || 'Use PATH' }}</code>
          </div>
          <div class="desktop-settings-view__actions">
            <button type="button" @click="chooseExecutable(executable)">
              Choose
            </button>
            <button type="button" @click="enterExecutablePath(executable)">
              Enter Path
            </button>
            <button
              v-if="settings.executablePaths[executable]"
              type="button"
              class="desktop-settings-view__danger"
              @click="clearExecutable(executable)"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section class="desktop-settings-view__panel">
        <h2>Diagnostics</h2>
        <div class="desktop-settings-view__actions">
          <button type="button" @click="bridge.openLogs()">
            Open Logs
          </button>
          <button type="button" @click="bridge.exportDiagnostics()">
            Export Diagnostics
          </button>
          <button type="button" @click="checkForUpdates">
            Check for Updates
          </button>
        </div>
      </section>
    </template>

    <p v-if="status" class="desktop-settings-view__status" role="status">
      {{ status }}
    </p>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  showConfirmationDialog,
  showPromptDialog
} from '../components/desktop/dialogService.js';
import { getDesktopBridge } from '../utils/desktopBridge.js';

const router = useRouter();
const bridge = getDesktopBridge();
const executables = ['copilot', 'claude', 'pi'];
const loading = ref(true);
const settings = ref(null);
const status = ref('');
let removeUpdateListener = null;

async function saveSettings() {
  try {
    const result = await bridge.updateSettings({
      updateChannel: settings.value.updateChannel,
      executablePaths: settings.value.executablePaths
    });
    status.value = result.restartRequired
      ? 'Settings saved. Restart to apply executable-path changes.'
      : 'Settings saved.';
  } catch (error) {
    status.value = `Could not save settings: ${error.message}`;
  }
}

async function chooseExecutable(executable) {
  try {
    const selected = await bridge.selectExecutable(executable);
    if (!selected) return;
    settings.value.executablePaths[executable] = selected;
    await saveSettings();
  } catch (error) {
    status.value = `Could not select executable: ${error.message}`;
  }
}

async function enterExecutablePath(executable) {
  const selected = await showPromptDialog({
    title: `Set ${executable} executable path`,
    message: 'Enter the absolute path to the executable.',
    label: 'Executable path',
    value: settings.value.executablePaths[executable] || '',
    confirmLabel: 'Save Path'
  });
  if (selected === null) return;
  settings.value.executablePaths[executable] = selected.trim() || null;
  await saveSettings();
}

async function clearExecutable(executable) {
  const confirmed = await showConfirmationDialog({
    title: `Clear ${executable} executable path?`,
    message: 'The desktop app will return to resolving this CLI from PATH.',
    destructive: true,
    confirmLabel: 'Clear Path'
  });
  if (!confirmed) return;
  settings.value.executablePaths[executable] = null;
  await saveSettings();
}

async function checkForUpdates() {
  status.value = 'Checking for updates...';
  try {
    await bridge.checkForUpdates();
  } catch (error) {
    status.value = `Update check failed: ${error.message}`;
  }
}

onMounted(async () => {
  if (!bridge) {
    await router.replace('/');
    return;
  }
  try {
    settings.value = await bridge.getSettings();
    removeUpdateListener = bridge.onUpdateStatus(update => {
      status.value = update.message || `Update status: ${update.state}`;
    });
  } catch (error) {
    status.value = `Desktop settings unavailable: ${error.message}`;
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => removeUpdateListener?.());
</script>

<style scoped>
.desktop-settings-view {
  margin: 0 auto;
  max-width: 960px;
  padding: 32px 24px 48px;
}

.desktop-settings-view__header {
  align-items: flex-start;
  display: flex;
  gap: 24px;
  justify-content: space-between;
  margin-bottom: 24px;
}

.desktop-settings-view__header h1 {
  color: var(--color-text);
  font-size: 32px;
  margin: 2px 0 6px;
}

.desktop-settings-view__header p,
.desktop-settings-view__description {
  color: var(--color-text-muted);
  margin: 0;
}

.desktop-settings-view__eyebrow {
  color: var(--color-accent) !important;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.desktop-settings-view__panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 16px;
  padding: 20px;
}

.desktop-settings-view__panel h2 {
  color: var(--color-text);
  font-size: var(--text-lg);
  margin: 0 0 16px;
}

.desktop-settings-view__field {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-top: 14px;
}

.desktop-settings-view__field span {
  display: grid;
  gap: 3px;
}

.desktop-settings-view small {
  color: var(--color-text-muted);
}

.desktop-settings-view select,
.desktop-settings-view button {
  background: var(--color-surface-alt);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  min-height: 34px;
  padding: 6px 10px;
}

.desktop-settings-view button {
  cursor: pointer;
}

.desktop-settings-view button:hover,
.desktop-settings-view button:focus-visible,
.desktop-settings-view select:focus-visible {
  border-color: var(--color-accent);
  outline: none;
}

.desktop-settings-view__back {
  flex: 0 0 auto;
}

.desktop-settings-view__executable {
  align-items: center;
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 14px 0;
}

.desktop-settings-view__executable:first-of-type {
  margin-top: 12px;
}

.desktop-settings-view__executable > div:first-child {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.desktop-settings-view__executable code {
  color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desktop-settings-view__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.desktop-settings-view__danger {
  color: var(--color-danger-emphasis) !important;
}

.desktop-settings-view__status {
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  color: var(--color-text-secondary);
  margin: 16px 0 0;
  padding: 10px 12px;
}

@media (max-width: 720px) {
  .desktop-settings-view__header,
  .desktop-settings-view__executable,
  .desktop-settings-view__field {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
