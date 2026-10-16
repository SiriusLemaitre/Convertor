param([string]$QpdfVersion = '12.4.2')
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$downloadFolder = Join-Path $workspaceRoot '.tools/engines'
$binaryFolder = Join-Path $workspaceRoot 'src-tauri/binaries'
$licenseFolder = Join-Path $binaryFolder 'licenses'
New-Item -ItemType Directory -Force -Path $downloadFolder,$binaryFolder,$licenseFolder | Out-Null

function Download-File([string]$Url, [string]$Destination) {
    & curl.exe -L --fail --connect-timeout 20 --max-time 300 -o $Destination $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}
function Assert-Checksum([string]$Archive, [string]$Manifest, [string]$AssetName) {
    $line = Get-Content -LiteralPath $Manifest | Where-Object { $_ -match ([regex]::Escape($AssetName) + '$') } | Select-Object -First 1
    if (-not $line) { throw "Checksum not found for $AssetName" }
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw "Checksum mismatch: $AssetName" }
}

$ffmpegBase = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
$ffmpegAsset = 'ffmpeg-master-latest-win64-gpl.zip'
$ffmpegZip = Join-Path $downloadFolder $ffmpegAsset
$ffmpegChecksums = Join-Path $downloadFolder 'ffmpeg-checksums.sha256'
Download-File "$ffmpegBase/$ffmpegAsset" $ffmpegZip
Download-File "$ffmpegBase/checksums.sha256" $ffmpegChecksums
Assert-Checksum $ffmpegZip $ffmpegChecksums $ffmpegAsset
Expand-Archive -LiteralPath $ffmpegZip -DestinationPath (Join-Path $downloadFolder 'ffmpeg') -Force
$ffmpegExe = Get-ChildItem (Join-Path $downloadFolder 'ffmpeg') -Filter ffmpeg.exe -Recurse | Select-Object -First 1
Copy-Item -LiteralPath $ffmpegExe.FullName -Destination (Join-Path $binaryFolder 'ffmpeg.exe')
Copy-Item -LiteralPath (Join-Path $ffmpegExe.DirectoryName 'ffprobe.exe') -Destination (Join-Path $binaryFolder 'ffprobe.exe')
Copy-Item -LiteralPath (Join-Path $ffmpegExe.Directory.Parent.FullName 'LICENSE.txt') -Destination (Join-Path $licenseFolder 'FFmpeg-GPL-3.0.txt')

$qpdfBase = "https://github.com/qpdf/qpdf/releases/download/v$QpdfVersion"
$qpdfAsset = "qpdf-$QpdfVersion-msvc64.zip"
$qpdfZip = Join-Path $downloadFolder $qpdfAsset
$qpdfChecksums = Join-Path $downloadFolder 'qpdf-checksums.sha256'
Download-File "$qpdfBase/$qpdfAsset" $qpdfZip
Download-File "$qpdfBase/qpdf-$QpdfVersion.sha256" $qpdfChecksums
Assert-Checksum $qpdfZip $qpdfChecksums $qpdfAsset
Expand-Archive -LiteralPath $qpdfZip -DestinationPath (Join-Path $downloadFolder 'qpdf') -Force
$qpdfExe = Get-ChildItem (Join-Path $downloadFolder 'qpdf') -Filter qpdf.exe -Recurse | Select-Object -First 1
Copy-Item -Path (Join-Path $qpdfExe.DirectoryName '*') -Destination $binaryFolder -Recurse -Force
Copy-Item -LiteralPath (Join-Path $qpdfExe.Directory.Parent.FullName 'share/doc/qpdf/manual-html/_sources/license.rst.txt') -Destination (Join-Path $licenseFolder 'qpdf-license.txt')
Download-File 'https://www.apache.org/licenses/LICENSE-2.0.txt' (Join-Path $licenseFolder 'Apache-2.0.txt')
Copy-Item (Join-Path $PSScriptRoot 'THIRD-PARTY.txt') (Join-Path $licenseFolder 'THIRD-PARTY.txt')
& (Join-Path $binaryFolder 'ffmpeg.exe') -version | Out-File (Join-Path $licenseFolder 'ffmpeg-build-info.txt') -Encoding utf8
& (Join-Path $binaryFolder 'qpdf.exe') --version
Write-Output 'FFmpeg, FFprobe, qpdf, and license notices are ready.'
