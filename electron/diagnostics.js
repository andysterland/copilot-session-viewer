const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

async function exportDiagnostics(options) {
  const zip = new AdmZip();
  const entries = await fs.promises.readdir(options.logsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('desktop.log')) {
      zip.addLocalFile(path.join(options.logsDirectory, entry.name), 'logs');
    }
  }
  zip.addFile('diagnostics.json', Buffer.from(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    platform: process.platform,
    architecture: process.arch,
    electronVersion: process.versions.electron
  }, null, 2)}\n`));
  zip.writeZip(options.destination);
  return options.destination;
}

module.exports = { exportDiagnostics };
