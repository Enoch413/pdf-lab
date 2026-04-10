param(
    [switch]$Clean = $true
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if ($Clean) {
    $buildTarget = Join-Path $projectRoot "build"
    if (Test-Path $buildTarget) {
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
    "--windowed",
    "--onefile",
    "--name", "PdfProblemTemplateRepacker",
    "--add-data", "pdf_problem_template_repacker.html;.",
    "--add-data", "pdf_problem_template_repacker.css;.",
    "--add-data", "assets;assets",
    "--add-data", "vendor;vendor",
    "desktop_launcher.py"
)

& py @args

$exePath = Join-Path $projectRoot "dist\PdfProblemTemplateRepacker.exe"
if (-not (Test-Path $exePath)) {
    throw "EXE was not created: $exePath"
}

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host $exePath
