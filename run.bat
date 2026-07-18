@echo off
title NOTES
echo.
echo   Установка зависимостей...
echo.
pip install -q flask scikit-learn 2>nul
echo   Запуск...
echo.
python "%~dp0app.py"
