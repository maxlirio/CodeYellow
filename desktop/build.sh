#!/bin/bash
# Build CodeOrange.app: copy the game into the shell, then package for macOS.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Copying game files"
rm -rf game
mkdir -p game
rsync -a --exclude 'desktop' --exclude '.git' --exclude 'node_modules' \
  ../index.html ../css ../js ../assets game/

echo "==> Packaging"
npx @electron/packager . CodeOrange \
  --platform=darwin --arch=arm64 \
  --icon=icon.icns \
  --app-bundle-id=io.github.maxlirio.codeorange \
  --out=dist --overwrite \
  --ignore='^/dist' --ignore='^/build.sh' --ignore='^/icon.iconset'

echo "==> Done: $(pwd)/dist/CodeOrange-darwin-arm64/CodeOrange.app"
