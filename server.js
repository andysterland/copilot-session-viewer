const fs = require('fs');
const path = require('path');
const os = require('os');
const createApp = require('./src/server/app');
const config = require('./src/server/config');
const processManager = require('./src/server/utils/processManager');
const { startServer } = require('./src/server/lifecycle');

try {
  fs.rmSync(path.join(os.homedir(), '.copilot-session-viewer', 'analytics-id'), { force: true });
} catch (error) {
  console.warn('Failed to remove legacy analytics identifier:', error.message);
}

// Create the Express app
const app = createApp();

// Export app for testing
module.exports = app;

// Start server only if not being required by tests
if (require.main === module) {
  let serverHandle;
  startServer({ app, port: config.PORT }).then((handle) => {
    serverHandle = handle;
    console.log(`🚀 Copilot Session Viewer running at http://localhost:${handle.port}`);
    console.log(`🔧 Environment: ${config.NODE_ENV}`);
    console.log(`⚡ Active processes: ${processManager.getActiveCount()}`);
  }).catch((error) => {
    console.error('❌ Failed to start Copilot Session Viewer:', error);
    process.exitCode = 1;
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📛 SIGTERM received, closing server...');
    serverHandle?.close().then(() => {
      console.log('✅ Server closed');
    }).catch((error) => {
      console.error('❌ Failed to close server:', error);
    });
  });
}