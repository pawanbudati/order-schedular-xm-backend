# XM360 Order Scheduler - Backend (AWS Windows VM Deployable)

Standalone Node.js + TypeScript High-Precision Backend Engine for XM / MetaTrader Order Scheduling running on AWS Windows Server VM.

## 🚀 How to Start the Backend Server Locally

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

## ☁️ Deploying on AWS EC2 Windows VM

### 1. Launch AWS EC2 Windows Instance
- **AMI:** Windows Server 2022 Base (or Windows Server 2019 / 2025).
- **Instance Type:** `t3.small` or `t3.medium` (Recommended: 2 vCPUs, 2GB–4GB RAM).
- **Storage:** 30 GB GP3.

### 2. Configure AWS Security Group & Windows Firewall
1. **AWS EC2 Security Group:**
   - In AWS Management Console ➔ **EC2** ➔ **Security Groups** ➔ Select Instance SG ➔ **Edit Inbound Rules**.
   - Add Custom TCP Rule: **Port `8444`**, Source: `0.0.0.0/0`.
   - Add SSH Rule: **Port `22`**, Source: `0.0.0.0/0` (for GitHub Actions SSH deployment).

2. **Windows Defender Firewall (Run inside VM via PowerShell as Admin):**
   ```powershell
   New-NetFirewallRule -DisplayName "XM Scheduler Backend Port 8444" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8444
   New-NetFirewallRule -DisplayName "OpenSSH Server Port 22" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22
   ```

---

### 3. Install Prerequisites on Windows VM (1-Click PowerShell Script)

Open **PowerShell (Administrator)** on your EC2 Windows VM and run this command block to download & install **Node.js LTS**, **Git**, refresh your **PATH**, and install **PM2**:

```powershell
# 1. Download & Install Node.js LTS
Write-Host "Downloading and installing Node.js LTS..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile "$env:TEMP\node.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\node.msi`" /quiet /qn" -Wait

# 2. Download & Install Git
Write-Host "Downloading and installing Git..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.2/Git-2.47.0.2-64-bit.exe" -OutFile "$env:TEMP\git.exe"
Start-Process "$env:TEMP\git.exe" -ArgumentList "/VERYSILENT /NORESTART" -Wait

# 3. Refresh PATH environment variable in current PowerShell window
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# 4. Install PM2 process manager globally
npm install -g pm2
```

> *(Note: If using `winget` on Windows Server, pass `--source winget` to bypass `msstore` certificate policies: `winget install OpenJS.NodeJS.LTS --source winget`)*



---

### 4. Enable OpenSSH Server for Automated GitHub Actions CI/CD

Run in **PowerShell (Administrator)**:

```powershell
# Install OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start SSH service & set to start automatically on Windows boot
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'

# Create OpenSSH registry key if it doesn't exist and set PowerShell as default shell
New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force

# Create application directory
New-Item -ItemType Directory -Force -Path 'C:\apps'

# Restart SSH service to load updated PATH environment variables
Restart-Service sshd
```



---

### 5. Automated GitHub Actions CI/CD Secrets Configuration

Add the following Secrets to your **GitHub Repository** (`Settings` ➔ `Secrets and variables` ➔ `Actions`):

- `AWS_WINDOWS_VM_HOST`: Public IPv4 Address or Public DNS of your AWS Windows EC2 instance.
- `AWS_WINDOWS_VM_USERNAME`: Windows Administrator username (e.g. `Administrator`).
- `AWS_WINDOWS_VM_PASSWORD`: Windows Administrator Password or SSH private key (`AWS_WINDOWS_VM_SSH_KEY`).

---

### 6. Running MetaTrader 5 (MT5) Natively on AWS Windows VM

Unlike Linux VMs, **AWS Windows VM supports MetaTrader 5 natively**:
1. Download and install **XM MetaTrader 5** (or standard MT5) directly on the Windows VM.
2. Log in with your XM account credentials in MT5.
3. The Node.js backend connects directly via **MetaApi Cloud** or local MT5 IPC bridge on `http://127.0.0.1:8555`.

---

### 7. Health Check Verification

Visually test your deployment by visiting in your browser:
```
http://<YOUR_AWS_WINDOWS_VM_PUBLIC_IP>:8444/health
```
Expected response:
```json
{
  "status": "ok",
  "timeIST": "2026-08-11 02:00:00.000 IST",
  "timestamp": 1786403400000
}
```

