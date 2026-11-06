@echo off
chcp 65001 >nul
title AI TokenWatch
echo ========================================================
echo  AI TokenWatch 대시보드 실행 중...
echo  - PC 로컬 대시보드: http://localhost:8089
echo  - 모바일 실시간 PWA: https://ysparkbc37D.github.io/AI_TokenWatch/
echo  (PC가 켜져 있는 동안 5분마다 깃허브로 자동 동기화됩니다)
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
