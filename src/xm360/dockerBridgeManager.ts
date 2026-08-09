import { exec } from 'child_process';
import util from 'util';
import dotenv from 'dotenv';
import { db } from '../store/db.js';

dotenv.config();
const execAsync = util.promisify(exec);

/**
 * Automatically ensures the Headless MT5 Docker Container is running on app boot/restart
 * Auto-detects credential changes in .env / DB and recreates the container seamlessly.
 */
export async function ensureDockerBridgeRunning(forceRecreate: boolean = false): Promise<void> {
  const config = db.getConfig();
  const accountId = config.accountId || process.env.XM_ACCOUNT_ID;
  const password = config.password || process.env.XM_PASSWORD;
  const serverName = config.serverName || process.env.XM_SERVER_NAME || 'XMGlobal-Real 30';

  if (!accountId || !password) {
    console.log('ℹ️ MT5 Docker Manager: XM_ACCOUNT_ID or XM_PASSWORD not found in DB / .env. Skipping auto Docker container startup.');
    return;
  }

  try {
    console.log('🔍 MT5 Docker Manager: Checking status of xm-mt5-bridge container...');
    const { stdout } = await execAsync('docker ps -a --format "{{.Names}}"');
    const containerNames = stdout.split('\n').map(n => n.trim());
    const containerExists = containerNames.includes('xm-mt5-bridge');

    let needsRecreation = forceRecreate;

    // Detect if credentials changed inside the container
    if (containerExists && !forceRecreate) {
      try {
        const { stdout: envStdout } = await execAsync('docker inspect --format "{{json .Config.Env}}" xm-mt5-bridge');
        const envArray: string[] = JSON.parse(envStdout || '[]');
        const curAccount = envArray.find(e => e.startsWith('MT5_ACCOUNT='))?.split('=')[1] || '';
        const curPassword = envArray.find(e => e.startsWith('MT5_PASSWORD='))?.split('=')[1] || '';
        const curServer = envArray.find(e => e.startsWith('MT5_SERVER='))?.split('=')[1] || '';

        if (curAccount !== accountId || curPassword !== password || curServer !== serverName) {
          console.log('🔄 MT5 Docker Manager: Detected updated credentials! Recreating Docker container...');
          needsRecreation = true;
        }
      } catch {
        needsRecreation = false;
      }
    }

    if (containerExists && needsRecreation) {
      console.log('🛑 MT5 Docker Manager: Removing old container to apply new credentials...');
      await execAsync('docker stop xm-mt5-bridge && docker rm xm-mt5-bridge').catch(() => {});
    }

    if (!containerExists || needsRecreation) {
      console.log(`🐳 MT5 Docker Manager: Starting XM MT5 Docker container for account ${accountId}...`);
      const runCmd = `docker run -d --name xm-mt5-bridge -e MT5_ACCOUNT="${accountId}" -e MT5_PASSWORD="${password}" -e MT5_SERVER="${serverName}" -p 8080:8080 --restart always gotson/docker-mt5`;
      await execAsync(runCmd);
      console.log('✅ MT5 Docker Manager: XM MT5 Docker container started successfully!');
    } else {
      const { stdout: runningStdout } = await execAsync('docker ps --format "{{.Names}}"');
      const isRunning = runningStdout.split('\n').map(n => n.trim()).includes('xm-mt5-bridge');

      if (!isRunning) {
        console.log('🔄 MT5 Docker Manager: Starting existing xm-mt5-bridge container...');
        await execAsync('docker start xm-mt5-bridge');
        console.log('✅ MT5 Docker Manager: XM MT5 Docker container restarted!');
      } else {
        console.log(`✅ MT5 Docker Manager: XM MT5 Docker container is active on port 8080 (Account: ${accountId}).`);
      }
    }
  } catch (err: any) {
    console.warn('⚠️ MT5 Docker Manager Notice:', err.message || err);
    if (forceRecreate) throw err;
  }
}

/**
 * Get status of local Headless MT5 Docker container
 */
export async function getDockerStatus(): Promise<{ containerRunning: boolean; containerExists: boolean; accountId?: string; error?: string }> {
  try {
    const { stdout } = await execAsync('docker ps -a --format "{{.Names}}"');
    const containerNames = stdout.split('\n').map(n => n.trim());
    const containerExists = containerNames.includes('xm-mt5-bridge');

    if (!containerExists) {
      return { containerRunning: false, containerExists: false };
    }

    const { stdout: runningStdout } = await execAsync('docker ps --format "{{.Names}}"');
    const isRunning = runningStdout.split('\n').map(n => n.trim()).includes('xm-mt5-bridge');

    const config = db.getConfig();
    const accountId = config.accountId || process.env.XM_ACCOUNT_ID;

    return { containerRunning: isRunning, containerExists: true, accountId };
  } catch (err: any) {
    return { containerRunning: false, containerExists: false, error: err.message || String(err) };
  }
}
