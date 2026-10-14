@echo off
rem Spadewick command line (PRD section 21): runs the application executable as a plain program, with no window.
rem Beside the application: resources\spadewick.cmd, with Spadewick.exe one folder up.
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\Spadewick.exe" "%~dp0app.asar\out\main\cli.js" %*
exit /b %ERRORLEVEL%
