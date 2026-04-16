@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>nul
if errorlevel 1 (
  echo Run this file as Administrator so Korean OCR data can be saved under Program Files.
  pause
  exit /b 1
)

where winget >nul 2>nul
if errorlevel 1 (
  echo winget is required. Install App Installer from Microsoft Store first.
  pause
  exit /b 1
)

echo Installing Python...
winget install --id Python.Python.3.13 -e --accept-package-agreements --accept-source-agreements

echo Installing Tesseract OCR...
winget install --id UB-Mannheim.TesseractOCR -e --accept-package-agreements --accept-source-agreements

set "PYTHON_CMD=py -3"
py -3 --version >nul 2>nul
if errorlevel 1 (
  set "PYTHON_CMD=python"
)

echo Installing Python packages...
%PYTHON_CMD% -m pip install --upgrade pip
%PYTHON_CMD% -m pip install -r "%~dp0requirements.txt"

set "TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe"
if not exist "%TESSERACT_CMD%" set "TESSERACT_CMD=C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"

if exist "%TESSERACT_CMD%" (
  echo Registering Tesseract path...
  setx PDFLAB_TESSERACT_CMD "%TESSERACT_CMD%"
  echo Downloading Korean OCR language data if missing...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd = '%TESSERACT_CMD%'; $tessdata = Join-Path (Split-Path -Parent $cmd) 'tessdata'; New-Item -ItemType Directory -Force -Path $tessdata | Out-Null; $kor = Join-Path $tessdata 'kor.traineddata'; if (!(Test-Path $kor)) { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/kor.traineddata' -OutFile $kor }; $eng = Join-Path $tessdata 'eng.traineddata'; if (!(Test-Path $eng)) { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata' -OutFile $eng }"
) else (
  echo Tesseract was installed, but tesseract.exe was not found in the default location.
  echo Set PDFLAB_TESSERACT_CMD manually to the full tesseract.exe path.
)

echo.
echo Setup complete. Close this window, then run START.bat or START_LIBRARY.bat again.
pause
