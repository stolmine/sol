#!/bin/bash
# Build Sol locally, install to /Applications, sign with a local identity.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDENTITY="${SOL_SIGN_IDENTITY:-Sol Local Signing}"
DD="$HOME/Library/Caches/sol-local-build"
LOG="$DD/build.log"
LOCK="macos/Podfile.lock"
mkdir -p "$DD"
cd "$ROOT"

LOCK_CHANGED=0
restore_lock() { if [ "$LOCK_CHANGED" = 1 ]; then (cd "$ROOT" && git checkout "$LOCK"); fi; }
trap restore_lock EXIT

echo "==> Checking Podfile.lock CocoaPods version"
POD_VER="$(pod --version)"
if ! grep -q "^COCOAPODS: $POD_VER\$" "$LOCK"; then
  sed -i '' -E "s/^COCOAPODS: .*/COCOAPODS: $POD_VER/" "$LOCK"
  LOCK_CHANGED=1
  echo "    temporarily set COCOAPODS: $POD_VER"
fi

echo "==> Building (log: $LOG)"
cd "$ROOT/macos"
if ! SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild -workspace sol.xcworkspace -scheme release \
  -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$DD" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" DEVELOPMENT_TEAM="" \
  build > "$LOG" 2>&1; then
  echo "BUILD FAILED. Tail of log:"; tail -n 40 "$LOG"; exit 1
fi
cd "$ROOT"

APP="$DD/Build/Products/Release/sol.app"
[ -d "$APP" ] || { echo "Missing $APP"; exit 1; }
[ -f "$APP/Contents/Resources/main.jsbundle" ] || { echo "Missing main.jsbundle"; exit 1; }
echo "==> Build OK, jsbundle present"

echo "==> Quitting running Sol"
osascript -e 'quit app id "com.ospfranco.sol"' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  pgrep -f /Applications/Sol.app/Contents/MacOS >/dev/null || break
  sleep 0.5
done

echo "==> Installing to /Applications/Sol.app"
rm -rf /Applications/Sol.app
ditto "$APP" /Applications/Sol.app

echo "==> Signing with '$IDENTITY'"
codesign --force --deep --sign "$IDENTITY" --options=0 --preserve-metadata=entitlements /Applications/Sol.app
codesign --verify --deep --strict /Applications/Sol.app
codesign -dr - /Applications/Sol.app

echo "==> Launching"
open /Applications/Sol.app
