import { exec } from 'child_process';
import util from 'util';
import dotenv from 'dotenv';
import { db } from '../store/db.js';

dotenv.config();
const execAsync = util.promisify(exec);

/**
 * Automatically ensures the Headless MT5 Docker Container is running on app boot/restart
 */
export async function ensureDockerBridgeRunning(): Promise<void> {
  const config = db.getConfig();
  const accountId = process.env.XM_ACCOUNT_ID || config.accountId;
  const password = process.env.XM_PASSWORD;
  const serverName = process.env.XM_SERVER_NAME || config.serverName || 'XMGlobal-Real 30';

  if (!accountId || !password) {
    console.log('ℹ️ MT5 Docker Manager: XM_ACCOUNT_ID or XM_PASSWORD not found in .env / DB. Skipping auto Docker container startup.');
    return;
  }

  try {
    console.log('🔍 MT5 Docker Manager: Checking status of xm-mt5-bridge container...');
    const { stdout } = await execAsync('docker ps -a --format "{{.Names}}"');
    const containerNames = stdout.split('\n').map(n => n.trim());
    const containerExists = containerNames.includes('xm-mt5-bridge');

    if (!containerExists) {
      console.log('🐳 MT5 Docker Manager: Starting Headless XM MT5 Docker container on port 8080...');
      const runCmd = `docker run -d --name xm-mt5-bridge -e MT5_ACCOUNT="${accountId}" -e MT5_PASSWORD="${password}" -e MT5_SERVER="${serverName}" -p 8080:8080 --restart always gotson/docker-mt5`;
      await execAsync(runCmd);
      console.log('✅ MT5 Docker Manager: Headless XM MT5 Docker container started successfully!');
    } else {
      const { stdout: runningStdout } = await execAsync('docker ps --format "{{.Names}}"');
      const runningNames = runningStdout.split('\n').map(n => n.trim());
      const isRunning = runningNames.includes('xm-mt5-bridge');

      if (!isRunning) {
        console.log('🔄 MT5 Docker Manager: Restarting existing xm-mt5-bridge container...');
        await execAsync('docker start xm-mt5-bridge');
        console.log('✅ MT5 Docker Manager: Headless XM MT5 Docker container restarted!');
      } else {
        console.log('✅ MT5 Docker Manager: Headless XM MT5 Docker container is active and running on port 8080.');
      }
    }
  } catch (err: any) {
    console.warn('⚠️ MT5 Docker Manager Notice:', err.message || err);
  }
}
