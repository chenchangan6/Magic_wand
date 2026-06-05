$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$out = Join-Path $PSScriptRoot "firmware"
$releasePath = Join-Path $PSScriptRoot "release.json"
if (-not (Test-Path $releasePath)) {
  throw "release.json was not found. Create or update it before refreshing firmware bins."
}
$release = Get-Content -Raw -Path $releasePath | ConvertFrom-Json

$items = @(
  @{
    Name = "controller"
    Build = Join-Path $root "firmware\controller\build"
    App = "magic_wand_controller.bin"
  },
  @{
    Name = "receiver"
    Build = Join-Path $root "firmware\receiver\build"
    App = "magic_wand_receiver.bin"
  }
)

foreach ($item in $items) {
  $target = Join-Path $out $item.Name
  New-Item -ItemType Directory -Force $target | Out-Null
  Copy-Item -Force (Join-Path $item.Build "bootloader\bootloader.bin") (Join-Path $target "bootloader.bin")
  Copy-Item -Force (Join-Path $item.Build "partition_table\partition-table.bin") (Join-Path $target "partition-table.bin")
  Copy-Item -Force (Join-Path $item.Build $item.App) (Join-Path $target $item.App)
  $manifestPath = Join-Path $target "manifest.json"
  if (Test-Path $manifestPath) {
    $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
    $expected = $release.firmware.PSObject.Properties[$item.Name].Value.version
    if (-not $expected) {
      throw "Missing firmware version for $($item.Name) in release.json"
    }
    $manifest.version = $expected
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 10) + "`n"), $utf8NoBom)
  }
  Write-Host "Updated $($item.Name) firmware files in $target"
}
