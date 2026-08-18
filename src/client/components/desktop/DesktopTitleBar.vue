<template>
  <header
    class="desktop-title-bar"
    :class="{
      'desktop-title-bar--inactive': !windowState.focused,
      'desktop-title-bar--mac': platform === 'darwin'
    }"
    data-testid="desktop-title-bar"
    @dblclick="handleDoubleClick"
  >
    <div v-if="platform === 'darwin'" class="desktop-title-bar__traffic-lights" aria-hidden="true" />
    <div class="desktop-title-bar__brand">
      <svg class="desktop-title-bar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M7 3h10v2h2a2 2 0 0 1 2 2v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a2 2 0 0 1 2-2h2V3Zm0 4H5v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h-2v2h-2V5H9v4H7V7Zm1 4h2v2H8v-2Zm6 0h2v2h-2v-2Z" />
      </svg>
      <span class="desktop-title-bar__app-name">Session Viewer</span>
    </div>
    <DesktopMenuBar
      ref="menuBar"
      :menus="menus"
      @activate="item => bridge.executeMenuCommand(item.id)"
    />
    <div class="desktop-title-bar__title">
      {{ viewTitle }}
    </div>
    <DesktopWindowControls
      v-if="platform !== 'darwin'"
      :bridge="bridge"
      :maximized="windowState.maximized"
    />
  </header>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import DesktopMenuBar from './DesktopMenuBar.vue';
import DesktopWindowControls from './DesktopWindowControls.vue';

const props = defineProps({
  bridge: {
    type: Object,
    required: true
  },
  platform: {
    type: String,
    required: true
  },
  windowState: {
    type: Object,
    required: true
  },
  menus: {
    type: Array,
    required: true
  }
});
const route = useRoute();
const menuBar = ref(null);
const viewTitle = computed(() => {
  if (route.name === 'time-analysis' || route.path.endsWith('/time-analyze')) return 'Time Analysis';
  if (route.path.includes('/session/')) return 'Session';
  return 'Copilot Session Viewer';
});

function handleDoubleClick(event) {
  if (props.platform === 'darwin' || event.target.closest('.desktop-no-drag')) return;
  props.bridge.toggleMaximizeWindow();
}

defineExpose({
  closeMenus: () => menuBar.value?.closeMenus()
});
</script>
