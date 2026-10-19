param([string]$ReleaseDir = 'release')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/env.ps1"
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    npm.cmd run package -- --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
    Copy-Item 'src-tauri/target/release/convertor.exe' (Join-Path $ReleaseDir 'Convertor.exe') -Force
    if (Test-Path 'src-tauri/target/release/WebView2Loader.dll') {
        Copy-Item 'src-tauri/target/release/WebView2Loader.dll' (Join-Path $ReleaseDir 'WebView2Loader.dll') -Force
    }
    Copy-Item 'src-tauri/binaries' $ReleaseDir -Recurse -Force
    Copy-Item 'LICENSE','README.md','Start-Web.cmd','Start-Web-Hosted.cmd' $ReleaseDir -Force
    $version = (Get-Content -Raw 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version
    Copy-Item "src-tauri/target/release/bundle/nsis/Convertor_${version}_x64-setup.exe" (Join-Path $ReleaseDir "Convertor_${version}_x64-setup.exe") -Force
    Write-Output "Portable app and installer are in $ReleaseDir."
} finally { Pop-Location }
