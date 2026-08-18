<template>
  <Teleport to="body">
    <div
      v-if="dialog"
      class="desktop-dialog-overlay"
      data-testid="desktop-dialog-overlay"
      @keydown="handleKeydown"
    >
      <section
        ref="dialogElement"
        class="desktop-dialog"
        :class="`desktop-dialog--${dialog.descriptor.type}`"
        :role="dialog.descriptor.type === 'error' ? 'alertdialog' : 'dialog'"
        aria-modal="true"
        :aria-labelledby="`${dialog.id}-title`"
        :aria-describedby="`${dialog.id}-description`"
        data-testid="desktop-dialog"
      >
        <div class="desktop-dialog__heading">
          <span class="desktop-dialog__icon" aria-hidden="true">{{ dialogIcon }}</span>
          <h2 :id="`${dialog.id}-title`">
            {{ dialog.descriptor.title }}
          </h2>
        </div>
        <div :id="`${dialog.id}-description`" class="desktop-dialog__body">
          <p>{{ dialog.descriptor.message }}</p>
          <p v-if="dialog.descriptor.detail" class="desktop-dialog__detail">
            {{ dialog.descriptor.detail }}
          </p>
          <label v-if="dialog.descriptor.input" class="desktop-dialog__input-label">
            <span v-if="dialog.descriptor.input.label">
              {{ dialog.descriptor.input.label }}
            </span>
            <input
              ref="inputElement"
              v-model="inputValue"
              data-dialog-focusable
              data-testid="desktop-dialog-input"
              type="text"
              :placeholder="dialog.descriptor.input.placeholder || ''"
            >
          </label>
        </div>
        <div class="desktop-dialog__actions">
          <button
            v-for="button in dialog.descriptor.buttons"
            :key="button.id"
            :ref="element => captureButton(button.id, element)"
            type="button"
            data-dialog-focusable
            :data-testid="`desktop-dialog-action-${button.id}`"
            class="desktop-dialog__button"
            :class="`desktop-dialog__button--${button.role || 'secondary'}`"
            @click="choose(button.id)"
          >
            {{ button.label }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getDesktopBridge } from '../../utils/desktopBridge.js';
import {
  activeDialog,
  cancelDialogRequest,
  resolveActiveDialog,
  showDialog
} from './dialogService.js';

const dialogElement = ref(null);
const inputElement = ref(null);
const inputValue = ref('');
const buttonElements = new Map();
const dialog = computed(() => activeDialog.value);
const desktopBridge = getDesktopBridge();
let previouslyFocused = null;
let removeDialogListener = null;
let removeDialogCancelListener = null;

const dialogIcon = computed(() => ({
  info: 'ⓘ',
  warning: '⚠',
  error: '⨯',
  confirmation: '?',
  destructive: '⚠',
  prompt: '✎'
})[dialog.value?.descriptor.type] || 'ⓘ');

function captureButton(id, element) {
  if (element) buttonElements.set(id, element);
  else buttonElements.delete(id);
}

function choose(action) {
  resolveActiveDialog(action, dialog.value?.descriptor.input ? inputValue.value : undefined);
}

function getFocusableElements() {
  return Array.from(
    dialogElement.value?.querySelectorAll('[data-dialog-focusable]:not([disabled])') || []
  );
}

function handleKeydown(event) {
  if (!dialog.value) return;
  const isCompositionShortcut = event.isComposing || event.keyCode === 229;
  if (isCompositionShortcut && (event.key === 'Escape' || event.key === 'Enter')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    choose(dialog.value.descriptor.cancelId);
    return;
  }
  if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON') {
    event.preventDefault();
    choose(dialog.value.descriptor.defaultId);
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = getFocusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    dialogElement.value?.focus();
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement);
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
    : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
  event.preventDefault();
  focusable[nextIndex].focus();
}

watch(dialog, async (current, previous) => {
  if (current && !previous) {
    previouslyFocused = document.activeElement;
    const appRoot = document.getElementById('app');
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute('aria-hidden', 'true');
    }
  }

  if (current) {
    inputValue.value = current.descriptor.input?.value || '';
    await nextTick();
    if (current.descriptor.input) inputElement.value?.focus();
    else buttonElements.get(current.descriptor.defaultId)?.focus();
    return;
  }

  if (previous) {
    const appRoot = document.getElementById('app');
    if (appRoot) {
      appRoot.inert = false;
      appRoot.removeAttribute('aria-hidden');
    }
    await nextTick();
    previouslyFocused?.focus?.();
    previouslyFocused = null;
  }
}, { flush: 'post' });

onMounted(async () => {
  if (!desktopBridge) return;
  removeDialogListener = desktopBridge.onDialogRequest(async request => {
    const result = await showDialog(request.descriptor, { requestId: request.requestId });
    if (!result) return;
    await desktopBridge.respondToDialog({
      requestId: request.requestId,
      action: result.action,
      value: result.value
    });
  });
  removeDialogCancelListener = desktopBridge.onDialogCancel(request => {
    cancelDialogRequest(request.requestId);
  });
  await desktopBridge.notifyDialogHostReady();
});

onUnmounted(() => {
  removeDialogListener?.();
  removeDialogCancelListener?.();
  const appRoot = document.getElementById('app');
  if (appRoot) {
    appRoot.inert = false;
    appRoot.removeAttribute('aria-hidden');
  }
});
</script>
