@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist package.json (
  echo 没找到 package.json，请确认这个文件在项目目录里。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo 没检测到 Node.js，请先安装 Node.js。
  pause
  exit /b 1
)

set ANTHROPIC_BASE_URL=https://llmhub.ltd
set OPENAI_MODEL=gpt-5.5

if "%ANTHROPIC_AUTH_TOKEN%"=="" (
  set /p ANTHROPIC_AUTH_TOKEN=请粘贴你的 API Key 后按回车:
)

if "%ANTHROPIC_AUTH_TOKEN%"=="" (
  echo API Key 不能为空。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 第一次启动，正在准备依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
)

set OPEN_BROWSER=1

echo 正在启动网页，浏览器会自动打开...
echo 关闭这个窗口，网页服务也会停止。
npm start
pause
