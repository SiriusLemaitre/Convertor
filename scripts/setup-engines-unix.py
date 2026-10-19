"""Bundle installed native engines and their shared-library closure, then relocate.

Run on the release runner after installing ffmpeg, qpdf, poppler and deno.
No package manager or Python is needed on the user's machine.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src-tauri/binaries'
LIB = OUT / 'lib'
MAC = platform.system() == 'Darwin'
OUT.mkdir(exist_ok=True)
LIB.mkdir(exist_ok=True)
NOTICES = OUT / 'licenses'
NOTICES.mkdir(exist_ok=True)


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def fetch(url):
    headers = {'User-Agent': 'Convertor-release'}
    if os.environ.get('GH_TOKEN') and url.startswith('https://api.github.com/'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as response:
        return response.read()


# Official standalone executables include Python and the YouTube challenge solver.
release = json.loads(fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'))
asset = 'yt-dlp_macos' if MAC else 'yt-dlp_linux'
base = 'https://github.com/yt-dlp/yt-dlp/releases/download/' + release['tag_name']
payload = fetch(base + '/' + asset)
manifest = fetch(base + '/SHA2-256SUMS').decode()
expected = next(line.split()[0] for line in manifest.splitlines() if line.split()[-1].lstrip('*') == asset)
assert hashlib.sha256(payload).hexdigest() == expected, 'yt-dlp checksum mismatch'
(OUT / 'yt-dlp').write_bytes(payload)
(OUT / 'yt-dlp').chmod(0o755)
for name in ['LICENSE', 'THIRD_PARTY_LICENSES.txt']:
    (NOTICES / ('yt-dlp-' + name)).write_bytes(fetch(f'https://raw.githubusercontent.com/yt-dlp/yt-dlp/{release["tag_name"]}/{name}'))

copied = {}
pending = []


def copy_binary(source, destination):
    source = Path(source).resolve()
    if source in copied:
        return copied[source]
    # Refuse silently replacing different libraries sharing a basename.
    if destination.exists() and destination.read_bytes() != source.read_bytes():
        raise RuntimeError(f'Library name collision: {destination}')
    shutil.copy2(source, destination)
    destination.chmod(0o755)
    copied[source] = destination
    pending.append(source)
    return destination


for name in ['ffmpeg', 'ffprobe', 'qpdf', 'pdftoppm', 'pdfinfo', 'deno']:
    source = shutil.which(name)
    assert source, f'Missing build dependency: {name}'
    copy_binary(source, OUT / name)

index = 0
while index < len(pending):
    source = pending[index]
    index += 1
    dest = copied[source]
    if MAC:
        dependencies = [line.strip().split(' (')[0] for line in run('otool', '-L', str(source)).splitlines()[1:]]
        # Homebrew bottles use absolute paths (including transitive dependencies).
        for dep in dependencies:
            if dep.startswith(('/usr/lib/', '/System/Library/')):
                continue
            if dep.startswith('@loader_path/'):
                resolved = source.parent / dep.removeprefix('@loader_path/')
            elif dep.startswith('/'):
                resolved = Path(dep)
            else:
                raise RuntimeError(f'Unresolved Mach-O dependency {dep} in {source}')
            target = copy_binary(resolved, LIB / resolved.name)
            relative = os.path.relpath(target, dest.parent)
            subprocess.check_call(['install_name_tool', '-change', dep, '@loader_path/' + relative, str(dest)])
        if dest.parent == LIB:
            subprocess.check_call(['install_name_tool', '-id', '@loader_path/' + dest.name, str(dest)])
    else:
        text = run('ldd', str(source))
        assert 'not found' not in text, text
        for dep in re.findall(r'(?:=>\s+|^\s*)(/[^\s]+)', text, re.M):
            copy_binary(dep, LIB / Path(dep).name)

if MAC:
    # Re-sign modified Mach-O files, then Tauri signs the outer app.
    for dest in reversed(list(copied.values())):
        subprocess.check_call(['codesign', '--force', '--sign', '-', str(dest)])
else:
    # Each engine uses its own bundled loader, isolating it from AppImage's libs.
    loader = next(LIB.glob('ld-linux-*.so.*'))
    for name in ['ffmpeg', 'ffprobe', 'qpdf', 'pdftoppm', 'pdfinfo', 'deno']:
        (OUT / name).rename(OUT / (name + '.bin'))
        (OUT / name).write_text('#!/bin/sh\n'
            'dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n'
            f'exec "$dir/lib/{loader.name}" --library-path "$dir/lib" "$dir/{name}.bin" "$@"\n')
        (OUT / name).chmod(0o755)

# Retain package copyrights and upstream source/build recipes with each bundle.
if MAC:
    formulae = json.loads(run('brew', 'info', '--json=v2', '--installed'))['formulae']
    for formula in formulae:
        prefix = Path(run('brew', '--prefix', formula['name']))
        for file in prefix.glob('*'):
            if file.is_file() and re.search('license|copying|notice', file.name, re.I):
                shutil.copy2(file, NOTICES / (formula['name'] + '-' + file.name))
    (NOTICES / 'homebrew-formulae.json').write_text(json.dumps(formulae, indent=2))
else:
    for directory in Path('/usr/share/doc').iterdir():
        copyright = directory / 'copyright'
        if copyright.is_file():
            shutil.copy2(copyright, NOTICES / (directory.name + '-copyright'))
    (NOTICES / 'packages.txt').write_text(run('dpkg-query', '-W'))
(NOTICES / 'sources.txt').write_text(
    'FFmpeg: https://ffmpeg.org/ (GPL/LGPL; see included build configuration)\n'
    'qpdf: https://github.com/qpdf/qpdf (Apache-2.0)\n'
    'Poppler: https://poppler.freedesktop.org/ (GPL-2.0-or-later)\n'
    'Deno: https://github.com/denoland/deno (MIT)\n'
    'yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/tag/' + release['tag_name'] + '\n'
    'Linux source packages: https://archive.ubuntu.com/ubuntu/pool/\n'
    'macOS source recipes: https://github.com/Homebrew/homebrew-core\n')
(NOTICES / 'ffmpeg-build-info.txt').write_text(run(str(OUT / 'ffmpeg'), '-version'))

# Verify after moving the entire tree, with package-manager paths removed.
import tempfile
with tempfile.TemporaryDirectory(prefix='convertor-bundle-') as temporary:
    relocated = Path(temporary) / 'binaries'
    shutil.copytree(OUT, relocated)
    for name, arg in [('ffmpeg', '-version'), ('ffprobe', '-version'), ('qpdf', '--version'),
                      ('pdftoppm', '-v'), ('pdfinfo', '-v'), ('yt-dlp', '--version'), ('deno', '--version')]:
        subprocess.run([str(relocated / name), arg], check=True, env={**os.environ, 'PATH': '/usr/bin:/bin'})
