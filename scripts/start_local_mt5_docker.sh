#!/bin/bash
# ===================================================================
# XM360 Order Scheduler - Automated Headless MT5 Docker Setup
# Runs 100% Free Headless MetaTrader 5 Bridge on GCP Linux VM ($0)
# ===================================================================

echo "🚀 Starting XM360 Headless MT5 Setup for GCP Linux VM..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
fi

# Stop existing container if running
if sudo docker ps -a | grep -q xm-mt5-bridge; then
    echo "🔄 Restarting existing xm-mt5-bridge container..."
    sudo docker stop xm-mt5-bridge && sudo docker rm xm-mt5-bridge
fi

# Prompt for credentials if not provided as environment variables
if [ -z "$XM_ACCOUNT" ]; then
    read -p "Enter XM Account ID (Login): " XM_ACCOUNT
fi

if [ -z "$XM_PASSWORD" ]; then
    read -sp "Enter XM Password: " XM_PASSWORD
    echo ""
fi

if [ -z "$XM_SERVER" ]; then
    read -p "Enter XM Server Name (default: XMGlobal-Real 30): " XM_SERVER
    XM_SERVER=${XM_SERVER:-"XMGlobal-Real 30"}
fi

echo "🐳 Launching Headless XM MT5 Container..."
sudo docker run -d \
  --name xm-mt5-bridge \
  -e MT5_ACCOUNT="$XM_ACCOUNT" \
  -e MT5_PASSWORD="$XM_PASSWORD" \
  -e MT5_SERVER="$XM_SERVER" \
  -p 8080:8080 \
  --restart always \
  gotson/docker-mt5

echo "-------------------------------------------------------------------"
echo "✅ Headless XM MT5 Container successfully started!"
echo "🌐 Local Execution Bridge running on: http://localhost:8080"
echo "-------------------------------------------------------------------"
echo "To check container logs: sudo docker logs -f xm-mt5-bridge"
