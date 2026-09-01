const fs = require('fs');
const path = require('path');
const checker = require('license-checker-rseidelsohn');

const root = path.join(__dirname, '..', '..');
const outputDirectory = path.join(root, 'electron', 'generated');
const outputPath = path.join(outputDirectory, 'THIRD_PARTY_LICENSES.txt');

function collectLicenses() {
  return new Promise((resolve, reject) => {
    checker.init({
      start: root,
      production: true,
      excludePrivatePackages: true
    }, (error, packages) => {
      if (error) {
        reject(new Error('Failed to collect third-party licenses', { cause: error }));
        return;
      }
      resolve(packages);
    });
  });
}

function readLicenseText(packageName, packageInfo) {
  if (!packageInfo.licenseFile) {
    return 'License text was not included in the installed package.';
  }

  try {
    return fs.readFileSync(packageInfo.licenseFile, 'utf8').trim();
  } catch (error) {
    throw new Error(`Failed to read the license for ${packageName}`, { cause: error });
  }
}

function formatLicenses(packages) {
  const sections = Object.entries(packages)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, packageInfo]) => {
      const licenses = Array.isArray(packageInfo.licenses)
        ? packageInfo.licenses.join(', ')
        : packageInfo.licenses || 'UNKNOWN';
      const metadata = [
        packageName,
        `License: ${licenses}`
      ];

      if (packageInfo.repository) {
        metadata.push(`Repository: ${packageInfo.repository}`);
      }
      if (packageInfo.publisher) {
        metadata.push(`Publisher: ${packageInfo.publisher}`);
      }
      if (packageInfo.copyright) {
        metadata.push(`Copyright: ${packageInfo.copyright}`);
      }

      return [
        ...metadata,
        '',
        readLicenseText(packageName, packageInfo)
      ].join('\n');
    });

  return [
    'Copilot Session Viewer',
    'Third-Party Software Licenses',
    '',
    'This distribution includes the following production dependencies.',
    '',
    sections.join('\n\n' + '-'.repeat(80) + '\n\n'),
    ''
  ].join('\n');
}

async function main() {
  const packages = await collectLicenses();
  const report = formatLicenses(packages);

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(outputPath, report, 'utf8');
  console.log(`Generated ${path.relative(root, outputPath)} for ${Object.keys(packages).length} packages`);
}

main().catch(error => {
  console.error('Failed to generate third-party license report:', error);
  process.exitCode = 1;
});
