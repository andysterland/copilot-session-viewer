<template>
  <DesktopShell v-if="desktopBridge" :bridge="desktopBridge">
    <router-view :key="$route.fullPath" />
  </DesktopShell>
  <router-view v-else :key="$route.fullPath" />
  <DesktopDialogHost />
</template>

<script setup>
import DesktopDialogHost from './components/desktop/DesktopDialogHost.vue';
import DesktopShell from './components/desktop/DesktopShell.vue';
import { getDesktopBridge } from './utils/desktopBridge.js';

const desktopBridge = getDesktopBridge();
document.documentElement.classList.toggle('desktop-host', Boolean(desktopBridge));
</script>
