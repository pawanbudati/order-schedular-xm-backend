# XM360 Order Scheduler - Backend (GCP VM Deployable)

Standalone Node.js + TypeScript High-Precision Backend Engine for XM / MetaTrader Order Scheduling.

## 🚀 How to Start the Backend Server

### Development Mode (Auto-Reloading)
```bash
cd order-schedular-xm-backend
npm install
npm run dev
```
> Server runs on **`http://localhost:8444`** (or `PORT` specified in `.env`).

### Production Mode
```bash
npm run build
npm start
```

---

## ☁️ Deploying on Google Cloud Platform (GCP) VM

### Standard Ubuntu/Debian Compute Engine VM Setup

1. **Create a GCP VM Instance:**
   - In GCP Console ➔ **Compute Engine** ➔ **VM instances** ➔ **Create Instance**.
   - **Machine Type:** `e2-micro` or `e2-small` (Debian 12 or Ubuntu 22.04 LTS).

2. **Allow Port 8444 in GCP Firewall:**
   - Go to **VPC network** ➔ **Firewall** ➔ **Create Firewall Rule**.
   - Name: `allow-xm-scheduler-port-8444`
   - Target tags: `http-server`
   - Source IPv4 ranges: `0.0.0.0/0`
   - Protocols and ports: Specified protocols and ports ➔ TCP: `8444`.

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
   - Visit `http://YOUR_GCP_VM_EXTERNAL_IP:8444/health` in your browser.
   - It should return `{"status":"ok"}`.

5. **Connect Frontend:**
   - Add `http://YOUR_GCP_VM_EXTERNAL_IP:8444/api` to your GitHub Repository Secret `VITE_API_BASE_URL` or enter it in the Web UI **API Settings** modal.
