@echo off
title КУРАТОР — Облачная версия
echo.
echo   Куратор запущен!
echo.
echo   Открой на телефоне:
echo   http://192.168.0.22:5556
echo.
echo   (оба устройства должны быть в одной WiFi-сети)
echo.
echo   Нажми Ctrl+C чтобы остановить
echo.
cd /d "%~dp0"
python -m http.server 5556 --bind 0.0.0.0
