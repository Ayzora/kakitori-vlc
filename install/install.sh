#!/bin/sh
set -eu

REPO="__REPO__"
BASE="${KAKITORI_BASE_URL:-https://github.com/$REPO/releases/latest/download}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Not supported: Kakitori runs on macOS and Windows x64."
  exit 1
fi
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
  rm -f "$STATE/bin/$tool"
  cp "$WORK/unzipped/bin/$tool" "$STATE/bin/$tool"
  chmod +x "$STATE/bin/$tool"
done
xattr -dr com.apple.quarantine "$STATE/bin" 2>/dev/null || true

echo "Done. Restart VLC, then click VLC → Extensions → Kakitori."
