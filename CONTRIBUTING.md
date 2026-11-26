# Contributing

Use Node.js 22 or later and pnpm (the version is pinned in `package.json`). The full example smoke also needs Python 3.11 or later and `uv` on PATH. Set `PROOFMARKS_UV` or `PROOFMARKS_NPM` to an absolute executable path when using an isolated PATH. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm smoke:package
```

Prettier formats the code: run `pnpm format` before committing. `pnpm lint` runs ESLint and fails on anything Prettier would change.

Tests use fake judges and stub agent commands. They require no provider keys, account access or agent CLIs. To reproduce a CI environment, create `.test-work/ci-bin`, link only your Node and pnpm executables there, and run tests with `PATH="$PWD/.test-work/ci-bin:/usr/bin:/bin:/usr/sbin:/sbin"`. Do not put real coding-agent CLIs on that PATH. For a fully independent install, set `PROOFMARKS_SMOKE_WORK` to a scratch directory outside any source checkout; this also checks that module resolution cannot find `tsx` or `esbuild` from ancestor directories. The package smoke isolates its HOME and PATH so `init` cannot register with your agents. Keep test and smoke output under `.test-work`.

The package smoke packs the built package, installs it into an empty project without development dependencies, exercises the CLI and MCP transport, and runs each example through the proxy with the fake judge. Example servers run only on loopback and are stopped afterward. No live Jev request is part of the checks.

The standalone program is Proofmarks built into Node's single executable format, for people without Node. Building it needs an official Node build from nodejs.org of the version it builds into (Homebrew's Node can't build single executables). After `pnpm build`:

```sh
node scripts/build-standalone.mjs                  # this machine; --target darwin-x64, linux-arm64, win-x64 and so on
node scripts/smoke-standalone.mjs .standalone/proofmarks-<version>-<target>.tar.gz
node scripts/build-wheels.mjs                      # Python wheels for every target built
node scripts/homebrew-formula.mjs                  # the Homebrew formula for this version
```

The standalone smoke runs the program with no Node on PATH and an empty HOME. Output goes to `.standalone`.

Use a short imperative commit subject and a body explaining the concrete behavior and validation. Keep source-editing, security, MCP tool names, events and overlay behavior compatible. Run the checks relevant to your change. For visible changes, inspect the rendered result, test keyboard use and reduced motion, and explain any intentional differences.

Generated JavaScript and declarations live in `dist` and are included in npm tarballs rather than committed. The build retains the font's OFL notice. The handwriting font in `src/overlay/font-data.ts` is Caveat (`fonts/caveat-variable.woff2`) cut down to the characters the overlay writes; after changing either, regenerate it with `uv run --no-project --with fonttools --with brotli scripts/subset-font.py`. Keep evaluation corpus hashes stable unless intentionally changing the calibration data. Do not add secrets or machine-specific paths.

## Releasing

CI runs on every push to `main` and every pull request once the repository is public. To release, set the version in `package.json`, replace `Unreleased.` under its `## [x.y.z]` heading in `CHANGELOG.md` with the release date, and push a matching tag such as `v0.2.0`. The release workflow checks that the tag matches the version and runs every check including the package smoke. It then builds the standalone program for macOS (arm64 and x64), Linux (x64 and arm64) and Windows (x64), signs and notarizes the macOS builds, and checks each build on its own platform: the smoke, `install.sh` or `install.ps1`, the Python wheel through uv, and Homebrew on macOS. Only then does it publish `@tortastudios/proofmarks` to npm with provenance, create the GitHub release from that changelog section with the archives and installers attached, publish the wheels to PyPI as `proofmarks`, and update the formula in `tortastudios/homebrew-tap`.

Publishing uses npm trusted publishing, so no npm token is stored. npm only lets a package that already exists trust a workflow, so the first version is published once by hand by a maintainer of the `@tortastudios` organization (`npm publish --access public`, with two-factor authentication), from the exact commit that will be tagged. The tagged release then sees that version is already on npm, skips publishing it, and does everything else. Then, in the package's settings on npmjs.com, add a trusted publisher for GitHub Actions with organization `tortastudios`, repository `proofmarks` and workflow `release.yml`. A new trusted publisher must publish within two days, so add it shortly before the first tagged release.

The rest of the release needs this set up once, before the first tag:

- **Apple signing**, as repository secrets. `APPLE_DEVELOPER_ID_P12` is the Developer ID Application certificate and its private key exported as a `.p12` file, base64-encoded, with its password in `APPLE_DEVELOPER_ID_P12_PASSWORD`. `APPLE_SIGN_IDENTITY` is the certificate's name, such as `Developer ID Application: Torta Studios (TEAMID)`.
- **Apple notarization**, as repository secrets, from an App Store Connect API key with the Developer role: `APPLE_NOTARY_KEY` (the `.p8` file, base64-encoded), `APPLE_NOTARY_KEY_ID` and `APPLE_NOTARY_ISSUER`.
- **PyPI**: a GitHub environment named `pypi`, and on pypi.org a pending trusted publisher for the project `proofmarks` with owner `tortastudios`, repository `proofmarks`, workflow `release.yml` and environment `pypi`. PyPI allows 10 GB per project by default, about 40 releases of these wheels; ask PyPI for more before then.
- **Homebrew**: a public repository `tortastudios/homebrew-tap`, and a `HOMEBREW_TAP_TOKEN` secret holding a fine-grained token that can write only to that repository's contents.

Before the first tag, and after any change to `release.yml`, rehearse the release: in the Actions tab, run the Release workflow by hand. It runs every check, builds and signs the programs, has Apple notarize the macOS ones, and installs and checks them on macOS, Linux and Windows. It also checks that `HOMEBREW_TAP_TOKEN` can push to the tap, with a dry run. Then it stops without publishing anything. The archives are attached to the run.

Contributions require agreement to [CLA.md](CLA.md), checked by the CLA Assistant bot. Maintainers enable the bot before public release. The project uses [FSL-1.1-MIT](LICENSE.md); examples and script-tag snippets use [MIT](examples/LICENSE).
