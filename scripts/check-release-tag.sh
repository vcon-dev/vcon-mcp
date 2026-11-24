#!/usr/bin/env bash
# Release guard for .github/workflows/publish.yml.
# Passes only for a run on a tag named v<package.json version>. A run from a branch
# (a manual dispatch from main, say) fails, so nothing publishes without a tag.
# Reads GITHUB_REF and GITHUB_REF_NAME; PACKAGE_JSON overrides the file for tests.
set -euo pipefail

ref="${GITHUB_REF:-}"
name="${GITHUB_REF_NAME:-}"
file="${PACKAGE_JSON:-package.json}"

case "$ref" in
  refs/tags/v*) ;;
  *) echo "::error::publishing needs a v* tag, but this run is on '${ref:-no ref}'"; exit 1 ;;
esac

pkg=$(node -p "require('$(cd "$(dirname "$file")" && pwd)/$(basename "$file")').version")
echo "tag: ${name#v} / package.json: $pkg"
[ "${name#v}" = "$pkg" ] || { echo "::error::release tag $name does not match package.json $pkg"; exit 1; }
