<template>
  <div
    class="desktop-shell"
    :class="[
      `desktop-shell--${windowState.platform}`,
      {
        'desktop-shell--inactive': !windowState.focused,
        'desktop-shell--maximized': windowState.maximized,
        'desktop-shell--fullscreen': windowState.fullScreen
      }
    ]"
    :style="{ '--desktop-display-scale': windowState.scaleFactor }"
  >
    <DesktopTitleBar
      ref="titleBar"
      :bridge="bridge"
      :platform="windowState.platform"
      :window-state="windowState"
      :menus="menus"
    />
    <main class="desktop-shell__content">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DesktopTitleBar from './DesktopTitleBar.vue';

const props = defineProps({
  bridge: {
    type: Object,
    required: true
  }
});
const route = useRoute();
const router = useRouter();
const titleBar = ref(null);
const menus = ref([]);
const rendererPlatform = navigator.platform.startsWith('Mac')
  ? 'darwin'
  : navigator.platform.startsWith('Linux')
    ? 'linux'
    : 'win32';
const windowState = reactive({
  maximized: false,
  minimized: false,
  focused: true,
  fullScreen: false,
  scaleFactor: 1,
  platform: rendererPlatform
});
let removeWindowStateListener = null;
let removeMenuCommandListener = null;

function updateWindowState(state) {
  Object.assign(windowState, state);
}

async function handleMenuCommand(commandId) {
  if (commandId === 'file.desktop-settings') {
    await router.push('/desktop/settings');
    return;
  }
  if (commandId === 'file.add-directory') {
    if (route.path !== '/') await router.push('/');
    await nextTick();
    window.dispatchEvent(new CustomEvent('desktop:add-directory'));
  }
}

watch(() => route.fullPath, () => titleBar.value?.closeMenus());

onMounted(async () => {
  try {
    menus.value = await props.bridge.getMenuCommands();
    updateWindowState(await props.bridge.getWindowState());
    removeWindowStateListener = props.bridge.onWindowStateChanged(updateWindowState);
    removeMenuCommandListener = props.bridge.onMenuCommand(handleMenuCommand);
    await props.bridge.notifyShellReady();
  } catch (_error) {
    await props.bridge.notifyShellReady({
      status: 'failed',
      stage: 'initialization'
    }).catch(() => {});
  }
});

onUnmounted(() => {
  removeWindowStateListener?.();
  removeMenuCommandListener?.();
});
</script>
