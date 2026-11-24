@echo off
rem One-time forced update for agent-deck installs at v0.2.2-rc1 or
rem earlier, whose own Update menu cannot work (see migrate_to_latest.py).
rem Put this folder anywhere (e.g. inside the agent-deck folder) and
rem double-click this file.
rem
rem ASCII-only and CRLF on purpose (cmd.exe reads .bat source as CP932 on
rem Japanese Windows); all Japanese text is printed by the Python script.
rem No multi-line ( ) blocks: single-line "if ... goto" only (see
rem python/tests/test_windows_utf8.py for why).
setlocal
set "HERE=%~dp0"
set "ROOT="

rem "%~dp0" ends with a backslash; "\." avoids a trailing "\" that would
rem escape the closing quote when passed as a quoted argument to Python.
if exist "%HERE%agent_config.json" set "ROOT=%HERE%."
if not defined ROOT if exist "%HERE%..\agent_config.json" set "ROOT=%HERE%.."
if defined ROOT goto :have_root

echo Drag the agent-deck folder (the one containing agent-deck.exe) into
echo this window, then press Enter:
set /p "ROOT="
if not defined ROOT goto :bad_root
set "ROOT=%ROOT:"=%"

:have_root
if not exist "%ROOT%\agent_config.json" goto :bad_root
set "PY=%ROOT%\venv\Scripts\python.exe"
set "TV="
"%PY%" -c "import googleapiclient" >nul 2>&1
if not errorlevel 1 goto :run

rem venv missing or broken (e.g. its base Python was uninstalled/upgraded).
rem Find a usable Python to build a temporary venv for this one update.
set "BASE="
python -c "import venv, sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 set "BASE=python"
if defined BASE goto :have_base
py -3 -c "import venv, sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 set "BASE=py -3"
if not defined BASE goto :no_python

:have_base
if not exist "%ROOT%\venv" goto :make_tmp_venv
"%PY%" -c "import sys" >nul 2>&1
if not errorlevel 1 goto :make_tmp_venv
set "BROKEN=venv.broken-%RANDOM%"
move "%ROOT%\venv" "%ROOT%\%BROKEN%" >nul
echo Moved the broken venv aside to "%BROKEN%" (rebuilt automatically on next launch).

:make_tmp_venv
set "TV=%TEMP%\agent-deck-migrate-%RANDOM%"
echo Preparing a temporary Python environment (about a minute)...
%BASE% -m venv "%TV%"
if errorlevel 1 goto :no_python
"%TV%\Scripts\python.exe" -m pip install -q --disable-pip-version-check google-auth google-auth-oauthlib google-api-python-client tomli
if errorlevel 1 goto :no_python
set "PY=%TV%\Scripts\python.exe"

:run
"%PY%" "%HERE%migrate_to_latest.py" "%ROOT%"
set "RC=%ERRORLEVEL%"
if defined TV rmdir /s /q "%TV%" 2>nul
if not "%RC%"=="0" goto :failed
echo.
echo Done. Start agent-deck.exe again.
goto :end

:bad_root
echo [ERROR] Not an agent-deck folder: "%ROOT%"
goto :end

:no_python
echo [ERROR] Could not prepare Python for the update.
echo         Download the org ZIP and extract it over the agent-deck folder instead.
goto :end

:failed
echo.
echo [ERROR] The update did not finish. See the messages above.
goto :end

:end
echo.
pause
