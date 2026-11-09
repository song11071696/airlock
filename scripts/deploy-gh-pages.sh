#!/usr/bin/env bash
# Build app/ and force-push app/dist to the gh-pages branch (GitHub Pages source: gh-pages, / root).
# GitHub Actions is disabled on the owner account, so Pages is served from this branch, not from the workflow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/app"
npm test
npm run build
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
TMP="$(mktemp -d)"
cp -r dist/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b gh-pages
git config user.name "Song11071696"
git config user.email "song11071696@users.noreply.github.com"
git add -A
git commit -qm "deploy: app/dist from main $SHA"
git push -f "${REMOTE:-https://github.com/song11071696/airlock.git}" gh-pages
echo "Deployed $SHA -> https://song11071696.github.io/airlock/"
