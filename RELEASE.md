# Release Process

## Automatic Version Bumping

### Using npm scripts (recommended)

```bash
# Patch release (0.1.0 → 0.1.1) - bug fixes
npm run release:patch

# Minor release (0.1.0 → 0.2.0) - new features
npm run release:minor

# Major release (0.1.0 → 1.0.0) - breaking changes
npm run release:major
```

**What happens:**
1. ✅ Updates `package.json` version
2. ✅ Creates git commit (`chore: release vX.Y.Z`)
3. ✅ Creates git tag (`vX.Y.Z`)
4. ✅ Pushes to GitHub
5. ✅ Creates GitHub release with auto-generated notes
6. ✅ Triggers npm publish workflow

---

### Manual npm version command

```bash
# Bump version
npm version patch -m "chore: release v%s"

# Push tag and code
git push --follow-tags

# Create GitHub release
gh release create v0.1.1 --title "v0.1.1" --generate-notes
```

---

## Semantic Versioning

Follow [SemVer](https://semver.org/):

- **Patch** (0.1.x) - Bug fixes, documentation, minor improvements
- **Minor** (0.x.0) - New features, backward-compatible changes
- **Major** (x.0.0) - Breaking changes, API changes

---

## Pre-Release Checklist

Before running `npm run release:*`, ensure:

- [ ] All tests pass (`npm run test:all`)
- [ ] Lint passes (`npm run lint:check`)
- [ ] `CHANGELOG.md` is updated
- [ ] Working directory is clean (`git status`)
- [ ] You're on `main` branch
- [ ] Branch is up to date with remote
- [ ] Electron unit and Playwright tests pass (`npm run test:electron && npm run test:electron:e2e`)
- [ ] Platform packages contain licenses, SBOM, updater metadata, and checksums
- [ ] Windows signatures and Apple signing/notarization are verified for a public production release

---

## Release Workflow

```mermaid
graph LR
    A[npm run release:patch] --> B[Update package.json]
    B --> C[Git commit + tag]
    C --> D[Push to GitHub]
    D --> E[Create GitHub Release]
    E --> F[Trigger npm-publish.yml]
    F --> G[Publish to npm]
    F --> H[Upload .tgz to release]
```

    ## Desktop Releases

    The `desktop-release.yml` workflow runs separately from npm publishing. A `v*` tag creates a draft release, builds Windows NSIS, macOS DMG/ZIP (x64 and arm64), and Linux AppImage artifacts, then publishes only after every platform succeeds. `package.json` is the authoritative version for npm, Electron, artifact names, and updater metadata.

    Required production signing secrets are documented by name in the workflow and remain in GitHub Actions:

    - Windows: `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`
    - Apple: `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

    Unsigned PR/nightly artifacts must be labeled as unsigned. They do not receive the production-release marker, so update checks remain disabled. Rotate certificates before expiration, update the relevant repository secrets, and validate signatures before publishing. If signing is unavailable, keep the release as a draft.

    Local Windows MSI builds use `npm run electron:dist:msi`. The script permits WiX warnings so a system-policy-blocked ICE validation pass (`LGHT1105`) does not abort packaging. Production desktop releases continue to use the signed NSIS target.

    To halt a faulty release, mark it as draft or delete its updater metadata. Publish a higher patch version for rollback; the updater rejects downgrades. Do not replace files on a published version because clients verify signatures and checksums.

---

## Troubleshooting

### "Working directory is not clean"
```bash
# Check what's uncommitted
git status

# Commit or stash changes
git add .
git commit -m "chore: prepare for release"
```

### "Tag already exists"
```bash
# Delete local tag
git tag -d v0.1.0

# Delete remote tag
git push origin :refs/tags/v0.1.0
```

### "gh command not found"
```bash
# Install GitHub CLI
brew install gh

# Authenticate
gh auth login
```

---

## Examples

### Patch release (bug fix)

```bash
# Fix bug
git commit -m "fix: resolve session parsing error"

# Release
npm run release:patch
# → v0.1.0 → v0.1.1
```

### Minor release (new feature)

```bash
# Add feature
git commit -m "feat: add dark mode toggle"

# Release
npm run release:minor
# → v0.1.0 → v0.2.0
```

### Major release (breaking change)

```bash
# Breaking change
git commit -m "feat!: redesign API endpoints"

# Release
npm run release:major
# → v0.1.0 → v1.0.0
```
