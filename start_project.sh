#!/bin/bash

# ---- Set project root ----
PROJECT_ROOT="/Users/yourname/path/to/your/project"

# ---- Start frontend in new Terminal window ----
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_ROOT' && npm start\""

# ---- Start backend in new Terminal window ----
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_ROOT/simple-php-backend' && php -S localhost:8080\""

# ---- Wait a few seconds ----
sleep 5

# ---- Open browser ----
open http://localhost:1234