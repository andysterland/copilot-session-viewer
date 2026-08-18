import './styles/main.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (resource, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfCookie = document.cookie
      .split('; ')
      .find(cookie => cookie.startsWith('csv-desktop-csrf='));
    if (csrfCookie) {
      const headers = new Headers(options.headers || {});
      headers.set('X-CSRF-Token', decodeURIComponent(csrfCookie.split('=').slice(1).join('=')));
      options = { ...options, headers };
    }
  }
  return originalFetch(resource, options);
};

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
