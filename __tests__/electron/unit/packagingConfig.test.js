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

  it('keeps the production Windows release on the NSIS target', () => {
    expect(packageMetadata.scripts['electron:dist:win']).toContain('electron-builder --win nsis');
    expect(packageMetadata.scripts['electron:dist:win']).toContain('--publish never');
  });

  it('allows the release workflow to publish unsigned packages', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'desktop-release.yml'),
      'utf8'
    );

    expect(workflow).not.toContain('require-signing-credentials');
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(workflow).toContain('building unsigned');
    expect(workflow).toContain('unset CSC_LINK CSC_KEY_PASSWORD');
    expect(workflow).toContain('npm run electron:dist:mac');
    expect(workflow).toContain("if: matrix.os == 'windows-latest' && env.CSC_LINK != ''");
    expect(workflow).toContain('gh release upload "$GITHUB_REF_NAME" "${artifacts[@]}" --clobber');
  });
});
