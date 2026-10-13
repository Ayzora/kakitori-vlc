#!/bin/sh
set -eu

if [ "$(uname -s)" = "Darwin" ]; then
  VLC_DIR="$HOME/Library/Application Support/org.videolan.vlc"
else
  VLC_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/vlc"
fi

pkill -x kakitori 2>/dev/null || true
rm -f "$VLC_DIR/lua/extensions/kakitori.lua"
rm -rf "$VLC_DIR/kakitori"

echo "Uninstalled. Restart VLC."
