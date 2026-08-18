<template>
  <div class="desktop-window-controls desktop-no-drag" aria-label="Window controls">
    <button type="button" aria-label="Minimize" data-testid="window-minimize" @click="bridge.minimizeWindow()">
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8v1H1z" /></svg>
    </button>
    <button
      type="button"
      :aria-label="maximized ? 'Restore' : 'Maximize'"
      data-testid="window-maximize"
      @click="bridge.toggleMaximizeWindow()"
    >
      <svg v-if="maximized" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 1h7v7H8V2H2V1zm-1 2h6v6H1V3zm1 1v4h4V4H2z" />
      </svg>
      <svg v-else viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 1h8v8H1V1zm1 1v6h6V2H2z" />
      </svg>
    </button>
    <button
      type="button"
      class="desktop-window-controls__close"
      aria-label="Close"
      data-testid="window-close"
      @click="bridge.closeWindow()"
    >
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1.4 2.1 2.1 1.4 5 4.3l2.9-2.9.7.7L5.7 5l2.9 2.9-.7.7L5 5.7 2.1 8.6l-.7-.7L4.3 5 1.4 2.1z" />
      </svg>
    </button>
  </div>
</template>

<script setup>
defineProps({
  bridge: {
    type: Object,
    required: true
  },
  maximized: {
    type: Boolean,
    required: true
  }
});
</script>
