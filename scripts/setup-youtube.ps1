$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$downloads = Join-Path $root '.tools/youtube'
$binaries = Join-Path $root 'src-tauri/binaries'
$licenses = Join-Path $binaries 'licenses'
New-Item -ItemType Directory -Force -Path $downloads,$binaries,$licenses | Out-Null
function Fetch([string]$Url, [string]$Destination) {
    & curl.exe -L --fail --retry 3 --connect-timeout 20 --max-time 300 -o $Destination $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}
# Resolve releases once, then download all artifacts from those exact tags.
Fetch 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' (Join-Path $downloads 'yt-release.json')
$yt = Get-Content -Raw (Join-Path $downloads 'yt-release.json') | ConvertFrom-Json
$base = "https://github.com/yt-dlp/yt-dlp/releases/download/$($yt.tag_name)"
$exe = Join-Path $downloads 'yt-dlp.exe'
Fetch "$base/yt-dlp.exe" $exe
Fetch "$base/SHA2-256SUMS" (Join-Path $downloads 'SHA2-256SUMS')
$line = Get-Content (Join-Path $downloads 'SHA2-256SUMS') | Where-Object { $_ -match '\s+\*?yt-dlp\.exe$' } | Select-Object -First 1
if (-not $line -or (Get-FileHash $exe -Algorithm SHA256).Hash -ne ($line -split '\s+')[0]) { throw 'yt-dlp checksum mismatch' }
Copy-Item -LiteralPath $exe -Destination $binaries -Force
Fetch "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$($yt.tag_name)/LICENSE" (Join-Path $licenses 'yt-dlp-LICENSE.txt')
Fetch "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$($yt.tag_name)/THIRD_PARTY_LICENSES.txt" (Join-Path $licenses 'yt-dlp-THIRD-PARTY.txt')
Fetch 'https://api.github.com/repos/denoland/deno/releases/latest' (Join-Path $downloads 'deno-release.json')
$deno = Get-Content -Raw (Join-Path $downloads 'deno-release.json') | ConvertFrom-Json
$asset = $deno.assets | Where-Object name -EQ 'deno-x86_64-pc-windows-msvc.zip'
if (-not $asset -or $asset.digest -notmatch '^sha256:([a-f0-9]{64})$') { throw 'Deno release has no SHA256 digest' }
$expected = $Matches[1]
$archive = Join-Path $downloads 'deno.zip'
Fetch $asset.browser_download_url $archive
if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Deno checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $downloads 'deno') -Force
Copy-Item -LiteralPath (Join-Path $downloads 'deno/deno.exe') -Destination $binaries -Force
Fetch "https://raw.githubusercontent.com/denoland/deno/$($deno.tag_name)/LICENSE.md" (Join-Path $licenses 'Deno-LICENSE.txt')
@("yt-dlp $($yt.tag_name)", "Deno $($deno.tag_name)") | Set-Content (Join-Path $licenses 'youtube-build-info.txt')
Write-Output 'YouTube downloader and JavaScript runtime are ready.'
