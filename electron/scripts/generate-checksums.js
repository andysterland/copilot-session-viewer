const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', '..');
const releaseDirectory = path.join(root, 'release', 'electron');
const outputName = `SHA256SUMS-${process.platform}.txt`;
const outputPath = path.join(releaseDirectory, outputName);

function getArtifactNames() {
  let entries;
  try {
    entries = fs.readdirSync(releaseDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error('Electron release directory could not be read', { cause: error });
  }

  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => !name.startsWith('builder-'))
    .filter(name => !name.startsWith('SHA256SUMS-'))
    .sort((left, right) => left.localeCompare(right));
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', error => {
      reject(new Error(`Failed to hash ${path.basename(filePath)}`, { cause: error }));
    });
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const artifactNames = getArtifactNames();
  if (artifactNames.length === 0) {
    throw new Error('No Electron release artifacts were found');
  }

  const lines = [];
  for (const artifactName of artifactNames) {
    const checksum = await hashFile(path.join(releaseDirectory, artifactName));
    lines.push(`${checksum}  ${artifactName}`);
  }

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Generated ${path.relative(root, outputPath)} for ${artifactNames.length} artifacts`);
}

main().catch(error => {
  console.error('Failed to generate Electron checksums:', error);
  process.exitCode = 1;
});
