@echo off
REM ?????? API ???????????python main.py?
setlocal
set NODE=C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
if not exist "%NODE%" set NODE=node

echo ============================================
echo   Trade CRM API Tests
echo ============================================
echo.

set BASE=http://127.0.0.1:8000

echo [1/4] API ????...
"%NODE%" "%~dp0api.test.mjs" || goto :fail
echo.
echo [2/4] ???????...
"%NODE%" "%~dp0e2e.test.mjs" || goto :fail
echo.
echo [3/4] Excel ????...
"%NODE%" "%~dp0import.test.mjs" || goto :fail
echo.
echo [4/4] ??????...
"%NODE%" "%~dp0validation.test.mjs" || goto :fail

echo.
echo ============================================
echo   ??????
echo ============================================
pause
exit /b 0

:fail
echo.
echo [FAILED] ???????????????
pause
exit /b 1
