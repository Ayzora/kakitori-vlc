#!/bin/sh
set -eu

VLC_DIR="$HOME/Library/Application Support/org.videolan.vlc"

pkill -x kakitori 2>/dev/null || true
rm -f "$VLC_DIR/lua/extensions/kakitori.lua"
rm -rf "$VLC_DIR/kakitori"

echo "Uninstalled. Restart VLC."
