# Kakitori installer for Windows x64.
#   irm https://github.com/__REPO__/releases/latest/download/install.ps1 | iex
# Re-running it upgrades in place and keeps the saved API key.
# KAKITORI_BASE_URL overrides where the release files come from (e.g. a
# file:// folder holding a local build), for testing.
#
# Runs inside a script block and ends with `return`, never `exit`: under
# `irm | iex` an exit would close the user's PowerShell window. ASCII only, so
# it survives being downloaded as text.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $repo = '__REPO__'
  $base = if ($env:KAKITORI_BASE_URL) { $env:KAKITORI_BASE_URL } else { "https://github.com/$repo/releases/latest/download" }

  # A 32-bit PowerShell on 64-bit Windows reports the real CPU here.
  $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($arch -ne 'AMD64') {
    Write-Host 'Not supported: Kakitori runs on Windows x64 and macOS.'
    return
  }

  $vlc = Join-Path $env:APPDATA 'vlc'
  $extensions = Join-Path $vlc 'lua\extensions'
  $bin = Join-Path $vlc 'kakitori\bin'
  $zip = 'kakitori-windows-x64.zip'

  # Windows can't replace a program that is running.
  if (Get-Process -Name kakitori -ErrorAction SilentlyContinue) {
    Write-Host 'A transcription is running. Run this again when it has finished.'
    return
  }

  $work = Join-Path ([IO.Path]::GetTempPath()) ('kakitori-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    Write-Host 'Downloading Kakitori for Windows x64...'
    $zipPath = Join-Path $work $zip
    $sumsPath = Join-Path $work 'SHA256SUMS.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$zip" -OutFile $zipPath
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $sumsPath

    $expected = $null
    foreach ($line in Get-Content $sumsPath) {
      $parts = $line.Trim() -split '\s+'
      if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $zip) { $expected = $parts[0] }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash
    if (-not $expected -or $expected.ToLowerInvariant() -ne $actual.ToLowerInvariant()) {
      Write-Host 'The download is damaged (checksum mismatch). Nothing was installed. Please try again.'
      return
    }

    $unzipped = Join-Path $work 'unzipped'
    Expand-Archive -Path $zipPath -DestinationPath $unzipped -Force
    New-Item -ItemType Directory -Force -Path $extensions, $bin | Out-Null
    Copy-Item -Path (Join-Path $unzipped 'kakitori.lua') -Destination $extensions -Force
    Copy-Item -Path (Join-Path $unzipped 'bin\*') -Destination $bin -Force
    Get-ChildItem -Path $bin | Unblock-File
    # config.json (the saved API key) is never touched.

    Write-Host 'Done. Restart VLC, then View > Kakitori > Transcribe.'
  } finally {
    Remove-Item -Recurse -Force -Path $work -ErrorAction SilentlyContinue
  }
}
