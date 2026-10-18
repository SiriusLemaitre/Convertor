$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
$release = Join-Path $root 'release'
$assets = Join-Path $root 'release-assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$installerName = "Convertor_${version}_x64-setup.exe"
$installer = Join-Path $release $installerName
if (-not (Test-Path -LiteralPath $installer)) { throw "Missing installer: $installer" }
Copy-Item -LiteralPath $installer -Destination $assets -Force
$portable = Get-ChildItem -LiteralPath $release | Where-Object Name -NotLike '*-setup.exe'
$zipName = "Convertor_${version}_windows-x64-portable.zip"
Compress-Archive -LiteralPath $portable.FullName -DestinationPath (Join-Path $assets $zipName) -Force
$lines = @($installerName, $zipName) | ForEach-Object {
    "$((Get-FileHash -LiteralPath (Join-Path $assets $_) -Algorithm SHA256).Hash.ToLower())  $_"
}
[System.IO.File]::WriteAllLines((Join-Path $assets 'SHA256SUMS.txt'), $lines, [System.Text.Encoding]::ASCII)
Write-Output "Release assets ready in $assets"
