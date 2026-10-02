param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
try {
  # Exclusive sharing checks the actual open handles, not the mere existence
  # of session.lock. No file contents are changed.
  $stream=[System.IO.File]::Open($Path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
  $stream.Dispose()
  exit 0
} catch { exit 1 }
