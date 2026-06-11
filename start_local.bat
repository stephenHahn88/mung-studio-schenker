@echo off
setlocal

set BACKEND_PORT=8080
set FRONTEND_PORT=1234
set DOCUMENTS_PATH=%cd%\documents

if not exist models\yolo26l_large_fullwidth_7pages_pre.pt if not exist models\yolo26l_large_fullwidth_9pages_pre_ep300.pt if not exist models\detr_large_9pages_plus50\model\model.safetensors (
  echo No large-symbol detector model was found. See models\README.md.
)

if not exist models\yolo26l_tiled_7pages_pre.pt if not exist models\yolo26l_tiled_9pages_pre_ep300.pt if not exist models\detr_tiled_9pages_plus50\model\model.safetensors (
  echo No small-symbol detector model was found. See models\README.md.
)

if not exist documents mkdir documents

set SIMPLE_PHP_BACKEND_URL=http://localhost:%BACKEND_PORT%
set YOLO26_BACKEND_URL=http://localhost:%BACKEND_PORT%

call npm run build
if errorlevel 1 exit /b 1

start "MuNG Studio Backend" cmd /k python simple-php-backend\server.py --port %BACKEND_PORT% --documents "%DOCUMENTS_PATH%"

echo.
echo MuNG Studio is running at http://localhost:%FRONTEND_PORT%
echo Backend is running at http://localhost:%BACKEND_PORT%
echo Simple Backend token: 123456789
echo.

npx http-server dist -a 127.0.0.1 -p %FRONTEND_PORT% --cors
