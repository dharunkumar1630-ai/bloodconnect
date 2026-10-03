@echo off
title BloodConnect GitHub & Vercel Push
cd /d "%~dp0"
cls
echo ===============================================================
echo     BLOODCONNECT: PUSHING UPDATES TO GITHUB & VERCEL
echo ===============================================================
echo.
echo If a window pops up asking you to sign in:
echo   1. Click "Sign in with your browser"
echo   2. Chrome will open the GitHub authorization page
echo   3. Click "Authorize"
echo.
echo Pushing now...
echo.
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo ===============================================================
    echo   [SUCCESS] Code pushed successfully to GitHub!
    echo   Vercel is now automatically redeploying your site!
    echo ===============================================================
) else (
    echo ===============================================================
    echo   [FAILED] Push did not complete.
    echo ===============================================================
)
echo.
pause

