$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/env.ps1"
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    npm.cmd run package
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
    New-Item -ItemType Directory -Force -Path 'release' | Out-Null
    Copy-Item 'src-tauri/target/release/convertor.exe' 'release/Convertor.exe' -Force
    if (Test-Path 'src-tauri/target/release/WebView2Loader.dll') {
        Copy-Item 'src-tauri/target/release/WebView2Loader.dll' 'release/WebView2Loader.dll' -Force
    }
    Copy-Item 'src-tauri/binaries' 'release' -Recurse -Force
    Copy-Item 'LICENSE','README.md' 'release' -Force
    $version = (Get-Content -Raw 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version
    Copy-Item "src-tauri/target/release/bundle/nsis/Convertor_${version}_x64-setup.exe" "release/Convertor_${version}_x64-setup.exe" -Force
    Write-Output 'Portable app and installer are in release/.'
} finally { Pop-Location }
