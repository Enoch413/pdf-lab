# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

app_root = Path(SPECPATH)
project_root = app_root.parent
runtime_files = [(str(path), 'app') for pattern in ('*.html', '*.css', '*.js') for path in app_root.glob(pattern)]
runtime_files += [(str(project_root / 'index.html'), '.'), (str(project_root / 'shared'), 'shared'),
                 (str(app_root / 'assets'), 'app/assets'), (str(app_root / 'vendor'), 'app/vendor'),
                 (str(project_root / 'dist/solbook_question_maker_portable/app'), 'dist/solbook_question_maker_portable/app')]


a = Analysis(
    ['desktop_launcher.py'],
    pathex=[str(project_root)],
    binaries=[],
    datas=runtime_files,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='PdfProblemTemplateRepacker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
