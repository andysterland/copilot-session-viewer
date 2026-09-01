const fs = require('fs');
const path = require('path');
const packageMetadata = require('../../../package.json');

describe('desktop packaging scripts', () => {
  it('builds local MSI packages without promoting policy-blocked ICE validation to an error', () => {
    expect(packageMetadata.scripts['electron:dist:msi']).toContain('electron-builder --win msi');
    expect(packageMetadata.scripts['electron:dist:msi'])
      .toContain('--config.msi.warningsAsErrors=false');
    expect(packageMetadata.scripts['electron:dist:msi']).toContain('--publish never');
  });

  it('keeps the local Windows distribution on the NSIS target', () => {
    expect(packageMetadata.scripts['electron:dist:win']).toContain('electron-builder --win nsis');
    expect(packageMetadata.scripts['electron:dist:win']).toContain('--publish never');
  });

  it('publishes only a signed or unsigned Windows MSI and compliance files', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'desktop-release.yml'),
      'utf8'
    );

    expect(workflow).not.toContain('require-signing-credentials');
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(workflow).toContain('building unsigned');
    expect(workflow).toContain('unset CSC_LINK CSC_KEY_PASSWORD');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('npm run electron:dist:msi');
    expect(workflow).toContain("find release/electron -maxdepth 1 -type f -name '*.msi'");
    expect(workflow).toContain('electron/generated/sbom.cdx.json');
    expect(workflow).toContain('electron/generated/THIRD_PARTY_LICENSES.txt');
    expect(workflow).not.toContain('macos-latest');
    expect(workflow).not.toContain('electron:dist:linux');
    expect(workflow).not.toContain('electron:checksums');
  });
});
