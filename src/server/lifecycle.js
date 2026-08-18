const http = require('http');
const createApp = require('./app');
const config = require('./config');

/**
 * Start the Express application and return an explicit lifecycle handle.
 * @param {{
 *   app?: import('express').Express,
 *   appOptions?: object,
 *   host?: string,
 *   port?: number|string,
 *   logger?: object
 * }} options startup options
 * @returns {Promise<{app: object, server: object, host: string, port: number, url: string, close: Function}>}
 */
async function startServer(options = {}) {
  const app = options.app || createApp(options.appOptions);
  const server = http.createServer(app);
  const requestedPort = options.port ?? config.PORT;
  const requestedHost = options.host;

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(new Error(`Failed to start HTTP server on ${requestedHost || 'default host'}:${requestedPort}`, { cause: error }));
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    if (requestedHost) {
      server.listen(requestedPort, requestedHost);
    } else {
      server.listen(requestedPort);
    }
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('HTTP server did not return a TCP address');
  }

  const host = requestedHost || address.address;
  const displayHost = host === '::' ? 'localhost' : host;
  const handle = {
    app,
    server,
    host,
    port: address.port,
    url: `http://${displayHost}:${address.port}`,
    close: () => closeServer(server)
  };

  options.logger?.info?.('server.started', {
    host,
    port: address.port
  });
  return handle;
}

/**
 * Close a server without failing when it was already stopped.
 * @param {import('http').Server} server HTTP server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(new Error('Failed to close HTTP server', { cause: error }));
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  closeServer,
  startServer
};
