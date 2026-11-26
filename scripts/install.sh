#!/bin/sh
# Installs the standalone Proofmarks program on macOS or Linux, no Node needed:
#
#   curl -fsSL https://github.com/tortastudios/proofmarks/releases/latest/download/install.sh | sh
#
# PROOFMARKS_VERSION    a version such as 0.2.0 (default: the latest release)
# PROOFMARKS_HOME       where it goes (default: ~/.proofmarks); the command is linked into its bin folder
# PROOFMARKS_DOWNLOAD_BASE  where the release files are (default: the GitHub release for that version)
set -eu

repo="tortastudios/proofmarks"
fail() { echo "Proofmarks: $*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "there is no standalone build for $(uname -s). In a Node project, use: npm install --save-dev @tortastudios/proofmarks" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "there is no standalone build for $(uname -m)." ;;
esac

version="${PROOFMARKS_VERSION:-}"
if [ -z "$version" ]; then
  # The latest release redirects to its tag, which needs no API call (and no API rate limit).
  latest="$(curl -fsL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")" || latest=""
  version="${latest##*/tag/}"
  case "$version" in v[0-9]*) ;; *) fail "couldn't find the latest release; set PROOFMARKS_VERSION." ;; esac
fi
version="${version#v}"
name="proofmarks-$version-$os-$arch"
base="${PROOFMARKS_DOWNLOAD_BASE:-https://github.com/$repo/releases/download/v$version}"
home="${PROOFMARKS_HOME:-$HOME/.proofmarks}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
echo "Downloading Proofmarks $version for $os-$arch"
curl -fsSL -o "$work/$name.tar.gz" "$base/$name.tar.gz" || fail "couldn't download $base/$name.tar.gz"
curl -fsSL -o "$work/$name.tar.gz.sha256" "$base/$name.tar.gz.sha256" || fail "couldn't download its checksum"
if command -v shasum >/dev/null 2>&1; then check="shasum -a 256 -c"; else check="sha256sum -c"; fi
(cd "$work" && $check "$name.tar.gz.sha256" >/dev/null 2>&1) || fail "the download doesn't match its checksum."

mkdir -p "$home/versions" "$home/bin"
# The version in use now, if any, from where the command points (.../versions/<name>/dist/companion/proofmarks).
previous="$(readlink "$home/bin/proofmarks" 2>/dev/null || true)"
previous="${previous%/dist/companion/proofmarks}"
previous="${previous##*/}"
rm -rf "${home:?}/versions/$name"
tar -xzf "$work/$name.tar.gz" -C "$home/versions"
# Only switch to the new version once it starts; a broken download leaves the old one in place.
if ! "$home/versions/$name/dist/companion/proofmarks" --help >/dev/null 2>&1; then
  [ "$previous" = "$name" ] || rm -rf "${home:?}/versions/$name"
  fail "the downloaded program didn't start."
fi
ln -sf "$home/versions/$name/dist/companion/proofmarks" "$home/bin/proofmarks"
# Keep this version and the one before it (a helper may still be running from it); remove older ones.
for folder in "$home/versions"/proofmarks-*; do
  [ -d "$folder" ] || continue
  case "${folder##*/}" in "$name" | "$previous") ;; *) rm -rf "$folder" ;; esac
done

echo "Installed Proofmarks $version: $home/bin/proofmarks"
case ":$PATH:" in
  *":$home/bin:"*) ;;
  *) echo "Add it to your PATH, for example in ~/.zshrc or ~/.bashrc:"
     echo "  export PATH=\"$home/bin:\$PATH\"" ;;
esac
