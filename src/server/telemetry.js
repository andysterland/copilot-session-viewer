/**
 * Application Insights Telemetry Module
 *
 * This module initializes and configures Application Insights for telemetry tracking.
 * Must be required BEFORE any other modules (especially Express) in server.js.
 *
 * Features:
 * - Explicit collection of sanitized requests
 * - Auto-collection of dependencies and performance counters
 * - Category-only reporting for explicitly tracked exceptions
 * - Custom event and metric tracking
 * - Automatic disabling in test environments
 * - Support for manual disabling via DISABLE_TELEMETRY env var
 */

const appInsights = require('applicationinsights');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SENSITIVE_PROPERTY = /(authorization|cookie|token|secret|password|prompt|content|events|sessionid|sessionidentifier|filepath|directory|executablepath|hostname|host)/i;
const MACHINE_TAGS = [
  'ai.cloud.roleInstance',
  'ai.device.id',
  'ai.device.machineName',
  'ai.device.ip',
  'ai.location.ip'
];

function sanitizeRoutePath(value) {
  let pathname;
  try {
    pathname = new URL(String(value), 'http://localhost').pathname;
  } catch {
    pathname = String(value).split('?')[0] || '/';
  }
  return pathname.replace(/(\/sessions\/)[^/]+/gi, '$1{sessionId}');
}

function sanitizeRequestUrl(value) {
  return `http://localhost${sanitizeRoutePath(value)}`;
}

function sanitizeRequestName(value) {
  const match = /^([A-Z]+)\s+(.+)$/.exec(String(value || ''));
  return match
    ? `${match[1]} ${sanitizeRoutePath(match[2])}`
    : sanitizeRoutePath(value);
}

function sanitizeTelemetryProperties(properties = {}) {
  return Object.fromEntries(Object.entries(properties)
    .filter(([key]) => !SENSITIVE_PROPERTY.test(key))
    .map(([key, value]) => {
      if (/url|path/i.test(key) && typeof value === 'string') {
        return [key, sanitizeRoutePath(value)];
      }
      return [key, value];
    }));
}

function createSafeException(error) {
  const safeName = typeof error?.name === 'string'
    && /^[A-Za-z][A-Za-z0-9]*Error$/.test(error.name)
    ? error.name
    : 'Error';
  const safeError = new Error('Operational error');
  safeError.name = safeName;
  safeError.stack = undefined;
  return safeError;
}

function sanitizeTelemetryEnvelope(envelope, appVersion, contextKeys = {}) {
  envelope.tags = envelope.tags || {};
  const machineTags = [
    ...MACHINE_TAGS,
    contextKeys.cloudRoleInstance,
    contextKeys.deviceId,
    contextKeys.deviceMachineName
  ].filter(Boolean);
  for (const tag of machineTags) delete envelope.tags[tag];
  const operationNameTag = contextKeys.operationName || 'ai.operation.name';
  if (typeof envelope.tags[operationNameTag] === 'string') {
    envelope.tags[operationNameTag] = sanitizeRequestName(envelope.tags[operationNameTag]);
  }

  const baseData = envelope.data?.baseData;
  if (!baseData) return true;
  baseData.properties = {
    ...sanitizeTelemetryProperties(baseData.properties),
    appVersion
  };
  if (typeof baseData.url === 'string') {
    baseData.url = sanitizeRequestUrl(baseData.url);
  }
  if (typeof baseData.name === 'string' && envelope.data.baseType === 'RequestData') {
    baseData.name = sanitizeRequestName(baseData.name);
  }
  return true;
}

/**
 * Get or create a persistent anonymous user ID.
 * Stored in ~/.copilot-session-viewer/analytics-id
 */
function getAnonymousId() {
  const dir = path.join(os.homedir(), '.copilot-session-viewer');
  const filePath = path.join(dir, 'analytics-id');
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    const id = crypto.randomUUID();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, id);
    } catch { /* ignore write errors */ }
    return id;
  }
}

/**
 * Get app version from package.json
 */
function getAppVersion() {
  try {
    // Try multiple paths (source vs bundled)
    const candidates = [
      path.join(__dirname, '../..', 'package.json'),
      path.join(__dirname, '..', 'package.json'),
      path.join(__dirname, 'package.json'),
    ];
    for (const p of candidates) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8')).version;
      } catch { /* try next */ }
    }
  } catch { /* ignore */ }
  return 'unknown';
}

// Determine if telemetry should be disabled
const DEFAULT_CONNECTION_STRING = 'InstrumentationKey=39f4fbf1-d82f-42c3-b4ef-ea92a1fd82cb;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=7d4bb432-f2f5-4526-a5e6-31901e5a2db2';
const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || DEFAULT_CONNECTION_STRING;
const isDisabled = process.env.DISABLE_TELEMETRY === 'true'
  || process.env.NODE_ENV === 'test';

let client = null;

if (!isDisabled) {
  try {
    // Setup and start Application Insights
    appInsights.setup(connectionString)
      .setAutoDependencyCorrelation(true)
      .setAutoCollectRequests(false)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(false)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(false) // Disable console tracking to avoid noise
      .setUseDiskRetryCaching(true)
      .setSendLiveMetrics(false) // Disable live metrics for local dev tool
      .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
      .start();

    client = appInsights.defaultClient;

    // Set context properties
    const appVersion = getAppVersion();
    const anonymousId = getAnonymousId();
    client.context.tags[client.context.keys.cloudRole] = 'copilot-session-viewer';
    client.context.tags[client.context.keys.applicationVersion] = appVersion;
    client.context.tags[client.context.keys.userId] = anonymousId;

    client.addTelemetryProcessor(envelope => sanitizeTelemetryEnvelope(
      envelope,
      appVersion,
      client.context.keys
    ));

    console.log('✅ Application Insights telemetry initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Application Insights:', error.message);
    // Continue without telemetry rather than crashing
    client = createNoOpClient();
  }
} else {
  // Return no-op client when disabled
  client = createNoOpClient();

  console.log('📊 Telemetry disabled');
}

/**
 * Creates a no-op client that safely ignores all telemetry calls
 * Used when telemetry is disabled or in test environments
 */
function createNoOpClient() {
  return {
    trackEvent: () => {},
    trackMetric: () => {},
    trackException: () => {},
    trackTrace: () => {},
    trackDependency: () => {},
    trackRequest: () => {},
    flush: (callback) => {
      if (callback) callback();
    }
  };
}

/**
 * Track a custom event
 * @param {string} name - Event name
 * @param {Object} properties - Event properties
 */
function trackEvent(name, properties = {}) {
  if (client && client.trackEvent) {
    client.trackEvent({
      name,
      properties: sanitizeTelemetryProperties(properties)
    });
  }
}

/**
 * Track a custom metric
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 * @param {Object} properties - Additional properties
 */
function trackMetric(name, value, properties = {}) {
  if (client && client.trackMetric) {
    client.trackMetric({
      name,
      value,
      properties: sanitizeTelemetryProperties(properties)
    });
  }
}

/**
 * Track an exception
 * @param {Error} error - Error object
 * @param {Object} properties - Additional properties
 */
function trackException(error, properties = {}) {
  if (client && client.trackException) {
    client.trackException({
      exception: createSafeException(error),
      properties: sanitizeTelemetryProperties(properties)
    });
  }
}

function trackRequest(request) {
  if (client && client.trackRequest) {
    client.trackRequest({
      ...request,
      name: sanitizeRequestName(request.name),
      url: sanitizeRequestUrl(request.url),
      resultCode: String(request.resultCode),
      properties: sanitizeTelemetryProperties(request.properties)
    });
  }
}

/**
 * Flush telemetry data (useful for short-lived processes)
 * @returns {Promise<void>}
 */
function flush() {
  return new Promise((resolve) => {
    if (client && client.flush) {
      client.flush({
        callback: () => resolve()
      });
    } else {
      resolve();
    }
  });
}

// Export the client and helper functions
module.exports = {
  client,
  createSafeException,
  trackEvent,
  trackMetric,
  trackException,
  trackRequest,
  flush,
  isEnabled: !isDisabled,
  sanitizeRequestName,
  sanitizeRequestUrl,
  sanitizeRoutePath,
  sanitizeTelemetryEnvelope,
  sanitizeTelemetryProperties
};
