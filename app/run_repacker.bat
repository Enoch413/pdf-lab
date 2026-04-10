@echo off
setlocal

if "%~1"=="" (
  echo PDF 파일을 이 배치 파일 위로 끌어다 놓거나, 명령줄에서 PDF 경로를 넘겨주세요.
  pause
  exit /b 1
)

set "SCRIPT_DIR=%~dp0"
python "%SCRIPT_DIR%generate_repacked_html.py" "%~1"

echo.
echo 완료되었습니다.
pause
