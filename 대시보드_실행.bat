@echo off
chcp 65001 >nul
title AI TokenWatch
echo ========================================================
echo  AI TokenWatch 대시보드 실행 중...
echo  - PC 로컬 대시보드: http://localhost:8089
echo  - 모바일 실시간 PWA: https://ysparkbc37D.github.io/AI_TokenWatch/
echo  (로컬 1분 정밀 기록 + 30분마다 깃허브 일괄 자동 동기화)
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
