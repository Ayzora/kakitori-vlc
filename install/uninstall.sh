#!/bin/sh
# Kakitori uninstaller for macOS.
#   curl -fsSL https://github.com/__REPO__/releases/latest/download/uninstall.sh | sh
# Removes the extension and the whole kakitori folder, including the saved
# API key. Subtitle tracks already added to videos stay in those files.
set -eu

VLC_DIR="$HOME/Library/Application Support/org.videolan.vlc"

pkill -x kakitori 2>/dev/null || true
rm -f "$VLC_DIR/lua/extensions/kakitori.lua"
rm -rf "$VLC_DIR/kakitori"

echo "Uninstalled. Restart VLC."
