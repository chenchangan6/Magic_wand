$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$out = Join-Path $PSScriptRoot "firmware"

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
    $manifest.version = Get-Date -Format "yyyy.MM.dd.HHmm"
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8
  }
  Write-Host "Updated $($item.Name) firmware files in $target"
}
