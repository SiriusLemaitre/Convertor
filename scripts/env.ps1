$workspaceRoot = Split-Path -Parent $PSScriptRoot
$nodeFolder = Get-ChildItem (Join-Path $workspaceRoot '.tools') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeFolder) { $env:PATH = "$($nodeFolder.FullName);$env:PATH" }
if (Test-Path (Join-Path $workspaceRoot '.tools/cargo/bin/cargo.exe')) {
    $env:RUSTUP_HOME = Join-Path $workspaceRoot '.tools/rustup'
    $env:CARGO_HOME = Join-Path $workspaceRoot '.tools/cargo'
    $env:PATH = "$(Join-Path $workspaceRoot '.tools/cargo/bin');$env:PATH"
}
$mingwBin = Join-Path $workspaceRoot '.tools/mingw/mingw64/bin'
if (Test-Path $mingwBin) { $env:PATH = "$mingwBin;$env:PATH" }
$env:npm_config_cache = Join-Path $workspaceRoot '.tools/npm-cache'
