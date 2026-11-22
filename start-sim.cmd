@echo off
REM Double-click to start the OSF Agri Flight Trainer. Extra options are passed through, e.g.:
REM   start-sim.cmd -SetupFirewall
REM   start-sim.cmd -Rebuild
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-sim.ps1" %*
pause
