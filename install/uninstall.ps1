# Kakitori uninstaller for Windows.
#   irm https://github.com/__REPO__/releases/latest/download/uninstall.ps1 | iex
# Removes the extension and the whole kakitori folder, including the saved
# API key. Subtitle tracks already added to videos stay in those files.
# Ends with `return`, never `exit`, so the PowerShell window stays open.

& {
  $vlc = Join-Path $env:APPDATA 'vlc'

  Get-Process -Name kakitori -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  Remove-Item -Force -Path (Join-Path $vlc 'lua\extensions\kakitori.lua') -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -Path (Join-Path $vlc 'kakitori') -ErrorAction SilentlyContinue

  Write-Host 'Uninstalled. Restart VLC.'
}
