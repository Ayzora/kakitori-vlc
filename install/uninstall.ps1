& {
  $vlc = Join-Path $env:APPDATA 'vlc'

  Get-Process -Name kakitori -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  Remove-Item -Force -Path (Join-Path $vlc 'lua\extensions\kakitori.lua') -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -Path (Join-Path $vlc 'kakitori') -ErrorAction SilentlyContinue

  Write-Host 'Uninstalled. Restart VLC.'
}
