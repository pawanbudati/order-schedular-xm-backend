# XM360 Order Scheduler - Backend (GCP VM Deployable)

Standalone Node.js + TypeScript High-Precision Backend Engine for XM / MetaTrader Order Scheduling.

## ☁️ Deploying on Google Cloud Platform (GCP) VM

### Option A: Standard Ubuntu/Debian Compute Engine VM

1. **Create a GCP VM Instance:**
   - In GCP Console ➔ **Compute Engine** ➔ **VM instances** ➔ **Create Instance**.
   - **Machine Type:** `e2-micro` or `e2-small` (Debian 12 or Ubuntu 22.04 LTS).
   - **Firewall:** Check **Allow HTTP traffic** and **Allow HTTPS traffic**.

2. **Allow Port 3001 in GCP Firewall:**
   - Go to **VPC network** ➔ **Firewall** ➔ **Create Firewall Rule**.
   - Name: `allow-xm-scheduler-port-3001`
   - Target tags: `http-server`
   - Source IPv4 ranges: `0.0.0.0/0`
   - Protocols and ports: Specified protocols and ports ➔ TCP: `3001`.

3. **Deploy Code on VM via SSH:**
   ```bash
   # 1. SSH into your GCP VM and install Node.js 20 & Git
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git build-essential

   # 2. Clone backend repo
   git clone https://github.com/pawanbudati/order-schedular-xm-backend.git
   cd order-schedular-xm-backend

   # 3. Install dependencies & build
   npm install
   npm run build

   # 4. Run with PM2 Process Manager (Auto-restart on reboot)
   sudo npm install -g pm2
   pm2 start pm2.config.js
   pm2 save
   pm2 startup
   ```

4. **Verify Health Check:**
   - Visit `http://YOUR_GCP_VM_EXTERNAL_IP:3001/health` in your browser.
   - It should return `{"status":"ok"}`.

5. **Connect Frontend:**
   - Paste `http://YOUR_GCP_VM_EXTERNAL_IP:3001/api` in your GitHub Pages Web UI **API Settings** modal.
