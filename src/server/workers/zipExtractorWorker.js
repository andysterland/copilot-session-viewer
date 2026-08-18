const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { isMainThread, parentPort, workerData } = require('worker_threads');

const DEFAULT_LIMITS = Object.freeze({
  maxCompressedBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxFiles: 1000,
  maxDepth: 5
});

function inspectEntry(entry) {
  const normalizedName = entry.entryName.replace(/\\/g, '/');
  const segments = normalizedName.split('/').filter(Boolean);
  const unixMode = (entry.attr >>> 16) & 0xF000;
  const uncompressedBytes = Number(entry.header?.size || 0);
  if (normalizedName.includes('\0')
    || normalizedName.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalizedName)
    || segments.some(segment => segment.includes(':'))
    || segments.includes('..')) {
    throw new Error(`Invalid archive path: ${entry.entryName}`);
  }
  if (unixMode === 0xA000) {
    throw new Error(`Symbolic links are not allowed in archives: ${entry.entryName}`);
  }
  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0) {
    throw new Error(`Invalid archive entry size: ${entry.entryName}`);
  }
  return {
    normalizedName,
    depth: Math.max(0, segments.length - 1),
    uncompressedBytes
  };
}

function openAndValidateArchive(zipPath, limits = DEFAULT_LIMITS) {
  const archiveLimits = { ...DEFAULT_LIMITS, ...limits };
  const stats = fs.statSync(zipPath);
  if (stats.size > archiveLimits.maxCompressedBytes) {
    throw new Error('Compressed file too large (max 50MB)');
  }

  let entries;
  try {
    const zip = new AdmZip(zipPath);
    entries = zip.getEntries();
  } catch (error) {
    throw new Error('Failed to read zip contents', { cause: error });
  }

  let totalSize = 0;
  let maxDepth = 0;
  for (const entry of entries) {
    const inspected = inspectEntry(entry);
    totalSize += inspected.uncompressedBytes;
    maxDepth = Math.max(maxDepth, inspected.depth);
  }
  if (totalSize > archiveLimits.maxUncompressedBytes) {
    throw new Error(
      `Uncompressed size too large (${Math.round(totalSize / 1024 / 1024)}MB > ${archiveLimits.maxUncompressedBytes / 1024 / 1024}MB)`
    );
  }
  if (entries.length > archiveLimits.maxFiles) {
    throw new Error(`Too many files in archive (${entries.length} > ${archiveLimits.maxFiles})`);
  }
  if (maxDepth > archiveLimits.maxDepth) {
    throw new Error(`Directory nesting too deep (${maxDepth} > ${archiveLimits.maxDepth})`);
  }
  return { archiveLimits, entries };
}

function extractArchive(zipPath, extractDir, limits = DEFAULT_LIMITS) {
  const { archiveLimits, entries } = openAndValidateArchive(zipPath, limits);
  const extractRoot = path.resolve(extractDir);
  fs.mkdirSync(extractRoot, { recursive: true });
  let extractedBytes = 0;

  for (const entry of entries) {
    const { normalizedName } = inspectEntry(entry);
    const targetPath = path.resolve(extractRoot, normalizedName);
    if (targetPath !== extractRoot && !targetPath.startsWith(`${extractRoot}${path.sep}`)) {
      throw new Error(`Invalid archive path: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    let data;
    try {
      data = entry.getData();
    } catch (error) {
      throw new Error(`Failed to read zip entry: ${entry.entryName}`, { cause: error });
    }
    extractedBytes += data.length;
    if (extractedBytes > archiveLimits.maxUncompressedBytes) {
      throw new Error('Uncompressed size too large (over 200MB)');
    }
    fs.writeFileSync(targetPath, data, { flag: 'wx' });
  }

  return { entries: entries.length, extractedBytes };
}

function runWorkerOperation(data) {
  if (data.operation === 'validate') {
    const { entries } = openAndValidateArchive(data.zipPath, data.limits);
    return { entries: entries.length };
  }
  if (data.operation === 'extract') {
    return extractArchive(data.zipPath, data.extractDir, data.limits);
  }
  throw new Error(`Unsupported ZIP worker operation: ${data.operation}`);
}

if (!isMainThread) {
  try {
    parentPort.postMessage({ ok: true, result: runWorkerOperation(workerData) });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
}

module.exports = {
  DEFAULT_LIMITS,
  extractArchive,
  inspectEntry,
  openAndValidateArchive,
  runWorkerOperation
};
