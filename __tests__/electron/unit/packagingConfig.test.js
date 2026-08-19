const packageMetadata = require('../../../package.json');

describe('desktop packaging scripts', () => {
  it('builds local MSI packages without promoting policy-blocked ICE validation to an error', () => {
    expect(packageMetadata.scripts['electron:dist:msi']).toContain('electron-builder --win msi');
    expect(packageMetadata.scripts['electron:dist:msi'])
      .toContain('--config.msi.warningsAsErrors=false');
  });

  it('keeps the production Windows release on the signed NSIS target', () => {
    expect(packageMetadata.scripts['electron:dist:win']).toContain('electron-builder --win nsis');
  });
});
