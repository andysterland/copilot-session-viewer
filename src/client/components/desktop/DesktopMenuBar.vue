<template>
  <nav ref="menuBarElement" class="desktop-menu-bar desktop-no-drag" aria-label="Application menu">
    <div v-for="(menu, index) in menus" :key="menu.id" class="desktop-menu-bar__group">
      <button
        :ref="element => captureTrigger(index, element)"
        type="button"
        class="desktop-menu-bar__trigger"
        :class="{ 'desktop-menu-bar__trigger--active': openMenuIndex === index }"
        :aria-expanded="openMenuIndex === index"
        aria-haspopup="menu"
        @click="toggleMenu(index)"
        @keydown="handleTriggerKeydown($event, index)"
        @mouseenter="switchOnHover(index)"
      >
        <span class="desktop-menu-bar__mnemonic">{{ menu.mnemonic }}</span>{{ menu.label.slice(1) }}
      </button>
      <DesktopContextMenu
        v-if="openMenuIndex === index"
        :items="menu.items"
        :label="`${menu.label} menu`"
        @activate="activate"
        @close="closeMenus(true)"
        @switch-menu="switchMenu"
      />
    </div>
  </nav>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import DesktopContextMenu from './DesktopContextMenu.vue';

defineProps({
  menus: {
    type: Array,
    required: true
  }
});
const emit = defineEmits(['activate']);
const menuBarElement = ref(null);
const openMenuIndex = ref(-1);
const triggers = new Map();
let restoreElement = null;

function captureTrigger(index, element) {
  if (element) triggers.set(index, element);
  else triggers.delete(index);
}

function openMenu(index) {
  if (openMenuIndex.value === -1) restoreElement = document.activeElement;
  openMenuIndex.value = index;
}

function toggleMenu(index) {
  if (openMenuIndex.value === index) closeMenus(true);
  else openMenu(index);
}

function closeMenus(restoreFocus = false) {
  openMenuIndex.value = -1;
  if (restoreFocus) {
    const target = restoreElement;
    restoreElement = null;
    target?.focus?.();
  }
}

function switchMenu(delta) {
  const count = triggers.size;
  if (count === 0) return;
  openMenuIndex.value = (openMenuIndex.value + delta + count) % count;
}

function switchOnHover(index) {
  if (openMenuIndex.value !== -1) openMenu(index);
}

async function activate(item) {
  closeMenus(true);
  await emit('activate', item);
}

function handleTriggerKeydown(event, index) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openMenu(index);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    const nextIndex = (index + delta + triggers.size) % triggers.size;
    triggers.get(nextIndex)?.focus();
    if (openMenuIndex.value !== -1) openMenu(nextIndex);
  } else if (event.key === 'Escape') {
    closeMenus(true);
  }
}

function handleDocumentPointer(event) {
  if (!menuBarElement.value?.contains(event.target)) closeMenus(false);
}

function handleDocumentKeydown(event) {
  if (event.key === 'F10' && !event.shiftKey) {
    event.preventDefault();
    triggers.get(0)?.focus();
    return;
  }
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  const menuIndex = Array.from(triggers.keys()).find(
    index => menuBarElement.value
      ?.querySelectorAll('.desktop-menu-bar__trigger')[index]
      ?.textContent.trim().startsWith(event.key.toUpperCase())
  );
  if (menuIndex !== undefined) {
    event.preventDefault();
    triggers.get(menuIndex)?.focus();
    openMenu(menuIndex);
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer);
  document.addEventListener('keydown', handleDocumentKeydown);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer);
  document.removeEventListener('keydown', handleDocumentKeydown);
});

defineExpose({ closeMenus });
</script>
