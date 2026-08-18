const fs = require('fs');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

function getExecutablePath(context) {
  const productName = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${productName}.app`, 'Contents', 'MacOS', productName);
  }
  if (context.electronPlatformName === 'win32') {
    return path.join(context.appOutDir, 'copilot-session-viewer.exe');
  }
  return path.join(context.appOutDir, 'copilot-session-viewer');
}

function getResourcesPath(context) {
  if (context.electronPlatformName === 'darwin') {
    const productName = context.packager.appInfo.productFilename;
    return path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

module.exports = async context => {
  await flipFuses(getExecutablePath(context), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  });

  const markerPath = path.join(getResourcesPath(context), 'production-release.json');
  await fs.promises.rm(markerPath, { force: true });
  if (process.env.ELECTRON_PRODUCTION_RELEASE === 'true') {
    await fs.promises.writeFile(markerPath, JSON.stringify({
      version: context.packager.appInfo.version,
      repository: 'andysterland/copilot-session-viewer'
    }), { encoding: 'utf8', mode: 0o600 });
  }
};
