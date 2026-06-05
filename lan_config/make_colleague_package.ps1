$ErrorActionPreference = "Stop"

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $projectRoot "dist"
$stage = Join-Path $dist "MagicWand_Local_Tool_$stamp"
$zip = "$stage.zip"

New-Item -ItemType Directory -Force $stage | Out-Null

$files = @(
  "flash.html",
  "index_ui_rebuild.html",
  "index_ui_rebuild.js",
  "tailwind.css",
  "serve.py",
  "serve.ps1",
  "serve_macos.sh",
  "start_config.cmd",
  "start_flasher.cmd",
  "start_config_mac.command",
  "start_flasher_mac.command",
  "README_FOR_COLLEAGUES.md",
  "GAMEPLAY_GUIDE.md"
)

foreach ($file in $files) {
  Copy-Item -Force (Join-Path $PSScriptRoot $file) (Join-Path $stage $file)
}

$extraDocs = Get-ChildItem -LiteralPath $PSScriptRoot -File |
  Where-Object {
    ($_.Extension -in @(".html", ".pdf")) -and
    ($_.Name -notin @("flash.html", "index.html", "index_ui_rebuild.html"))
  }

foreach ($item in $extraDocs) {
  Copy-Item -Force -LiteralPath $item.FullName -Destination (Join-Path $stage $item.Name)
}

Copy-Item -Recurse -Force (Join-Path $PSScriptRoot "firmware") (Join-Path $stage "firmware")

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $stageRoot = [System.IO.Path]::GetFullPath($stage)
  foreach ($item in Get-ChildItem -Path $stage -Recurse -File) {
    $itemPath = [System.IO.Path]::GetFullPath($item.FullName)
    $relative = $itemPath.Substring($stageRoot.Length).TrimStart('\', '/').Replace('\', '/')
    $entry = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $itemPath, $relative)
    if ($relative -in @("serve_macos.sh", "start_config_mac.command", "start_flasher_mac.command")) {
      $entry.ExternalAttributes = (0x81ED -shl 16)
    } else {
      $entry.ExternalAttributes = (0x81A4 -shl 16)
    }
  }
} finally {
  $archive.Dispose()
}

Write-Host "Package created:"
Write-Host $zip
