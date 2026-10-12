#!/bin/sh
# Kakitori installer for macOS (Apple Silicon and Intel).
#   curl -fsSL https://github.com/__REPO__/releases/latest/download/install.sh | sh
# Re-running it upgrades in place and keeps the saved API key.
# KAKITORI_BASE_URL overrides where the release files come from (e.g. a
# file:// folder holding a local build), for testing.
set -eu

REPO="__REPO__"
BASE="${KAKITORI_BASE_URL:-https://github.com/$REPO/releases/latest/download}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Not supported: Kakitori runs on macOS and Windows x64."
  exit 1
fi
# Ask the hardware, not the shell: a shell running under Rosetta reports x86_64.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  PLATFORM="macos-arm64"
elif [ "$(uname -m)" = "x86_64" ]; then
  PLATFORM="macos-x64"
else
  echo "Not supported: unknown Mac processor $(uname -m)."
  exit 1
fi

VLC_DIR="$HOME/Library/Application Support/org.videolan.vlc"
EXTENSIONS="$VLC_DIR/lua/extensions"
STATE="$VLC_DIR/kakitori"
ZIP="kakitori-$PLATFORM.zip"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Downloading Kakitori for $PLATFORM..."
curl -fsSL "$BASE/$ZIP" -o "$WORK/$ZIP"
curl -fsSL "$BASE/SHA256SUMS.txt" -o "$WORK/SHA256SUMS.txt"

EXPECTED="$(awk -v f="$ZIP" '$2 == f || $2 == "*" f { print $1 }' "$WORK/SHA256SUMS.txt")"
ACTUAL="$(shasum -a 256 "$WORK/$ZIP" | awk '{ print $1 }')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "The download is damaged (checksum mismatch). Nothing was installed. Please try again."
  exit 1
fi

mkdir -p "$WORK/unzipped"
unzip -q "$WORK/$ZIP" -d "$WORK/unzipped"

mkdir -p "$EXTENSIONS" "$STATE/bin"
cp "$WORK/unzipped/kakitori.lua" "$EXTENSIONS/kakitori.lua"
for tool in kakitori ffmpeg ffprobe; do
  # Remove first so a running copy keeps its old file instead of being overwritten.
  rm -f "$STATE/bin/$tool"
  cp "$WORK/unzipped/bin/$tool" "$STATE/bin/$tool"
  chmod +x "$STATE/bin/$tool"
done
# Unsigned programs: clear the quarantine flag so Gatekeeper doesn't block them.
xattr -dr com.apple.quarantine "$STATE/bin" 2>/dev/null || true
# config.json (the saved API key) is never touched.

echo "Done. Restart VLC, then VLC → Extensions → Kakitori → Transcribe."
