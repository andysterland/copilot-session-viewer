<template>
  <div
    ref="menuElement"
    class="desktop-context-menu"
    role="menu"
    :aria-label="label"
    @keydown="handleKeydown"
  >
    <template v-for="(item, index) in items" :key="item.id || `separator-${index}`">
      <div
        v-if="item.type === 'separator'"
        class="desktop-context-menu__separator"
        role="separator"
      />
      <button
        v-else
        :ref="element => captureItem(index, element)"
        type="button"
        role="menuitem"
        class="desktop-context-menu__item"
        :disabled="item.disabled"
        :aria-disabled="item.disabled ? 'true' : undefined"
        :data-command-id="item.id"
        @click="activate(item)"
        @mouseenter="focusIndex(index)"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.accelerator" class="desktop-context-menu__accelerator">
          {{ item.accelerator }}
        </span>
      </button>
    </template>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue';

const props = defineProps({
  items: {
    type: Array,
    required: true
  },
  label: {
    type: String,
    required: true
  }
});
const emit = defineEmits(['activate', 'close', 'switch-menu']);
const menuElement = ref(null);
const itemElements = new Map();
let activeIndex = -1;

function captureItem(index, element) {
  if (element) itemElements.set(index, element);
  else itemElements.delete(index);
}

function enabledIndexes() {
  return props.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type !== 'separator' && !item.disabled)
    .map(({ index }) => index);
}

function focusIndex(index) {
  if (!enabledIndexes().includes(index)) return;
  activeIndex = index;
  itemElements.get(index)?.focus();
}

function moveFocus(delta) {
  const indexes = enabledIndexes();
  if (indexes.length === 0) return;
  const currentPosition = indexes.indexOf(activeIndex);
  const nextPosition = currentPosition === -1
    ? 0
    : (currentPosition + delta + indexes.length) % indexes.length;
  focusIndex(indexes[nextPosition]);
}

function activate(item) {
  if (!item.disabled) emit('activate', item);
}

function handleKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveFocus(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(-1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusIndex(enabledIndexes()[0]);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusIndex(enabledIndexes().at(-1));
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    emit('switch-menu', -1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    emit('switch-menu', 1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}

onMounted(async () => {
  await nextTick();
  moveFocus(1);
});
</script>
