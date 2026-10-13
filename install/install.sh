#!/bin/sh
set -eu

REPO="__REPO__"
BASE="${KAKITORI_BASE_URL:-https://github.com/$REPO/releases/latest/download}"

case "$(uname -s)" in
  Darwin)
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
      PLATFORM="macos-arm64"
    elif [ "$(uname -m)" = "x86_64" ]; then
      PLATFORM="macos-x64"
    else
      echo "Not supported: unknown Mac processor $(uname -m)."
      exit 1
    fi
    VLC_DIR="$HOME/Library/Application Support/org.videolan.vlc"
    MENU="VLC → Extensions → Kakitori"
    ;;
  Linux)
    if [ "$(uname -m)" != "x86_64" ]; then
      echo "Not supported: Kakitori runs on 64-bit Intel and AMD Linux PCs, not $(uname -m)."
      exit 1
    fi
    if [ ! -x /usr/bin/vlc ]; then
      echo "Kakitori needs VLC installed with apt. Run: sudo apt install vlc"
      echo "The Snap and Flatpak versions of VLC aren't supported."
      exit 1
    fi
    if ! command -v unzip >/dev/null 2>&1; then
      echo "The installer needs unzip. Run: sudo apt install unzip"
      exit 1
    fi
    PLATFORM="linux-x64"
    VLC_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/vlc"
    MENU="View → Kakitori"
    ;;
  *)
    echo "Not supported: Kakitori runs on macOS, Windows x64 and Linux x64."
    exit 1
    ;;
esac

EXTENSIONS="$VLC_DIR/lua/extensions"
STATE="$VLC_DIR/kakitori"
ZIP="kakitori-$PLATFORM.zip"

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  else
    wget -qO "$2" "$1"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Downloading Kakitori for $PLATFORM..."
download "$BASE/$ZIP" "$WORK/$ZIP"
download "$BASE/SHA256SUMS.txt" "$WORK/SHA256SUMS.txt"

EXPECTED="$(awk -v f="$ZIP" '$2 == f || $2 == "*" f { print $1 }' "$WORK/SHA256SUMS.txt")"
ACTUAL="$(sha256 "$WORK/$ZIP")"
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

if [ "$PLATFORM" = "linux-x64" ] && ! command -v notify-send >/dev/null 2>&1; then
  echo "To get a notification when a transcription is done, run: sudo apt install libnotify-bin"
fi
echo "Done. Restart VLC, then click $MENU."
