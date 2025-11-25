#!/bin/bash
echo "Start Selenium (ensure selenium-server-4.15.0.jar is in ~/Downloads)"
echo "Start it in a separate terminal: java -jar ~/Downloads/selenium-server-4.15.0.jar standalone"
echo "Starting backend..."
cd backend
npm install --silent
nohup node server.js > ../backend.log 2>&1 &
echo "Backend started"
echo "Build runner (mvn required)..."
cd ../runner
mvn -q clean package
echo "Runner built"
echo "Start static dashboard server (http://localhost:5500)"
cd ../dashboard
nohup python3 -m http.server 5500 > ../dashboard.log 2>&1 &
echo "Dashboard started at http://localhost:5500"
echo "Open Chrome and load extension from extension/ via chrome://extensions (Developer mode)"
