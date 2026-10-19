param(
    [switch]$Clean = $true
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if ($Clean) {
    $buildTarget = Join-Path $projectRoot "build"
    if (Test-Path $buildTarget) {
        if ((Resolve-Path -LiteralPath $buildTarget).Path -ne [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'build'))) {
            throw "Unexpected build output path: $buildTarget"
        }
        Remove-Item -LiteralPath $buildTarget -Recurse -Force
    }

    $distTarget = Join-Path $projectRoot "dist"
    if (Test-Path $distTarget) {
        $exeTarget = Join-Path $distTarget "PdfProblemTemplateRepacker.exe"
        if (Test-Path $exeTarget) {
            Remove-Item -LiteralPath $exeTarget -Force
        }
    }
}

$args = @(
    "-3",
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "PdfProblemTemplateRepacker.spec"
)

& py @args

$exePath = Join-Path $projectRoot "dist\PdfProblemTemplateRepacker.exe"
if (-not (Test-Path $exePath)) {
    throw "EXE was not created: $exePath"
}

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host $exePath
