import { Router } from 'express';
import { xm360Client } from '../xm360/client.js';
import { schedulerEngine } from '../scheduler/engine.js';
import { db } from '../store/db.js';
import { ScheduledOrder } from '../types/index.js';

const router = Router();

// System Status & Clock Sync Info
const formatIST = (timestamp: number): string => {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  parts.forEach(p => { map[p.type] = p.value; });
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}.${ms} IST`;
};

// System Status & Clock Sync Info
router.get('/status', async (req, res) => {
  const sync = await xm360Client.syncServerTime();
  const config = db.getConfig();
  const activeAcc = db.getActiveAccount();
  const isConnected = Boolean(sync.mt5Connected);

  res.json({
    status: 'online',
    serverTime: sync.serverTime,
    serverTimeIST: formatIST(sync.serverTime),
    localTime: sync.localTime,
    localTimeIST: formatIST(sync.localTime),
    offsetMs: sync.offsetMs,
    mt5Connected: isConnected,
    hasApiKeys: isConnected,
    accountId: activeAcc?.accountId || config.accountId,
    accountName: activeAcc?.accountName || `MT5 Account ${config.accountId}`,
    serverName: activeAcc?.serverName || config.serverName,
    platform: activeAcc?.platform || config.platform,
    activeAccountId: db.getActiveAccountId(),
    accountsCount: db.getAccounts().length,
  });
});

// Accounts Management Endpoints
router.get('/accounts', async (req, res) => {
  const accounts = db.getAccounts();
  const activeAccountId = db.getActiveAccountId();
  const activeAccount = db.getActiveAccount();

  // Try fetching detected running MT5 instances from local bridge
  const detected = await xm360Client.getDetectedInstances();

  res.json({
    success: true,
    data: {
      accounts,
      activeAccountId,
      activeAccount,
      detectedInstances: detected.instances || [],
      configuredPaths: detected.configured_paths || [],
    },
  });
});

router.post('/accounts', (req, res) => {
  try {
    const { accountId, accountName, serverName, platform, password, terminalPath } = req.body;
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'Account ID (MT5 Login) is required' });
    }

    const newAcc = db.addAccount({
      accountId: String(accountId).trim(),
      accountName: accountName ? String(accountName).trim() : `MT5 Account ${accountId}`,
      serverName: serverName ? String(serverName).trim() : 'XMGlobal-Real 30',
      platform: platform === 'MT4' ? 'MT4' : 'MT5',
      password: password ? String(password).trim() : undefined,
      terminalPath: terminalPath ? String(terminalPath).trim() : undefined,
    });

    res.json({ success: true, data: newAcc, accounts: db.getAccounts(), activeAccountId: db.getActiveAccountId() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/accounts/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.updateAccount(id, req.body);
  if (updated) {
    res.json({ success: true, data: updated, accounts: db.getAccounts(), activeAccountId: db.getActiveAccountId() });
  } else {
    res.status(404).json({ success: false, error: `Account ${id} not found` });
  }
});

router.delete('/accounts/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.deleteAccount(id);
  if (deleted) {
    res.json({ success: true, message: 'Account deleted', accounts: db.getAccounts(), activeAccountId: db.getActiveAccountId() });
  } else {
    res.status(404).json({ success: false, error: `Account ${id} not found` });
  }
});

router.post('/accounts/switch', async (req, res) => {
  const { accountId, id } = req.body;
  const targetId = id || accountId;

  if (!targetId) {
    return res.status(400).json({ success: false, error: 'Target Account ID is required' });
  }

  const switched = db.setActiveAccountId(targetId);
  if (switched) {
    // Attempt context switch in local MT5 bridge
    await xm360Client.connectLocalBridge({
      accountId: switched.accountId,
      serverName: switched.serverName,
      terminalPath: switched.terminalPath,
      password: switched.password,
    });

    res.json({
      success: true,
      message: `Switched active account to ${switched.accountName || switched.accountId}`,
      activeAccount: switched,
      activeAccountId: db.getActiveAccountId(),
    });
  } else {
    res.status(404).json({ success: false, error: `Account ${targetId} not found` });
  }
});

// Admin Passcode / Password Verification
router.post('/verify-passcode', (req, res) => {
  const { passcode, password, pin } = req.body || {};
  const entered = String(passcode || password || pin || '').trim();

  const config = db.getConfig();
  const expectedPassword = String(
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSCODE ||
    process.env.ADMIN_PIN ||
    config.passcode ||
    '1234'
  ).trim();

  if (entered && entered === expectedPassword) {
    return res.json({
      success: true,
      message: 'Admin authentication successful',
      role: 'ADMIN',
    });
  } else {
    return res.status(401).json({
      success: false,
      message: 'Incorrect Admin PIN or Password.',
    });
  }
});

// Update XM360 API Configuration
router.post('/config', (req, res) => {
  const { apiToken, accountId, serverName, platform, recvWindow, terminalPath } = req.body;
  const updated = db.updateConfig({
    ...(apiToken !== undefined && { apiToken }),
    ...(accountId !== undefined && { accountId }),
    ...(serverName !== undefined && { serverName }),
    ...(platform !== undefined && { platform }),
    ...(recvWindow !== undefined && { recvWindow }),
    ...(terminalPath !== undefined && { terminalPath }),
  });

  if (accountId) {
    db.addAccount({
      accountId: String(accountId),
      serverName: serverName || 'XMGlobal-Real 30',
      platform: platform || 'MT5',
      terminalPath,
    });
  }

  // Re-sync time with XM Broker Server
  xm360Client.syncServerTime();

  res.json({
    success: true,
    config: {
      apiToken: updated.apiToken ? '••••••••' + updated.apiToken.slice(-4) : '',
      accountId: updated.accountId,
      serverName: updated.serverName,
      platform: updated.platform,
      recvWindow: updated.recvWindow,
    },
  });
});

// Explicit Manual Connection Trigger for MT5 Local Bridge
router.post('/config/connect-mt5', async (req, res) => {
  try {
    const { accountId } = req.body || {};
    const result = await xm360Client.connectLocalBridge(accountId ? { accountId: String(accountId) } : undefined);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message || 'Error connecting to local MT5 Bridge' });
  }
});

// Get Account Balance & Purchasing Power
router.get('/balance', async (req, res) => {
  try {
    const accId = req.query.accountId as string | undefined;
    const balance = await xm360Client.getAccountBalance(accId);
    res.json({ success: true, data: balance });
  } catch (err: any) {
    res.json({
      success: true,
      data: {
        asset: 'USD',
        balance: 0,
        equity: 0,
        availableMargin: 0,
        usedMargin: 0,
        currency: 'USD',
        marginLevel: 0,
      },
    });
  }
});

// Get Trading Pairs & Tickers
router.get('/pairs', async (req, res) => {
  try {
    const accId = req.query.accountId as string | undefined;
    const tickers = await xm360Client.getTickers(accId);
    res.json({ success: true, data: tickers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Schedule a New Order
router.post('/schedule', (req, res) => {
  try {
    const {
      symbol,
      side,
      positionSide,
      type,
      price,
      quantity,
      leverage,
      targetTime,
      stopLoss,
      takeProfit,
      accountId,
      accountName,
      serverName,
      terminalPath,
    } = req.body;

    if (!symbol || !side || !quantity || !targetTime) {
      return res.status(400).json({ success: false, error: 'Missing required parameters (symbol, side, quantity, targetTime)' });
    }

    const activeAcc = db.getAccounts().find((a) => a.id === accountId || a.accountId === accountId) || db.getActiveAccount();
    const targetAccountId = accountId || activeAcc?.accountId || db.getConfig().accountId;
    const targetAccountName = accountName || activeAcc?.accountName || `MT5 Account ${targetAccountId}`;
    const targetServerName = serverName || activeAcc?.serverName || db.getConfig().serverName;
    const targetTerminalPath = terminalPath || activeAcc?.terminalPath;

    const id = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const targetTimeFormatted = formatIST(Number(targetTime));

    const newOrder: ScheduledOrder = {
      id,
      symbol: String(symbol).toUpperCase(),
      side: side === 'SELL' ? 'SELL' : 'BUY',
      positionSide: positionSide || (side === 'SELL' ? 'SHORT' : 'LONG'),
      type: type === 'LIMIT' ? 'LIMIT' : 'MARKET',
      price: price ? parseFloat(price) : undefined,
      quantity: parseFloat(quantity),
      leverage: leverage ? parseInt(leverage, 10) : 1000,
      targetTime: Number(targetTime),
      targetTimeFormatted,
      status: 'PENDING',
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
      createdAt: Date.now(),
      accountId: targetAccountId,
      accountName: targetAccountName,
      serverName: targetServerName,
      terminalPath: targetTerminalPath,
    };

    db.addOrder(newOrder);
    schedulerEngine.scheduleOrder(newOrder);

    res.json({ success: true, data: newOrder });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List All Orders
router.get('/orders', (req, res) => {
  const orders = db.getOrders();
  res.json({ success: true, data: orders });
});

// Cancel a Scheduled Order
router.delete('/orders/:id', (req, res) => {
  const { id } = req.params;
  const success = schedulerEngine.cancelOrder(id);

  if (success) {
    res.json({ success: true, message: `Order ${id} cancelled.` });
  } else {
    res.status(404).json({ success: false, error: `Order ${id} not found or not in pending state.` });
  }
});

// Get Logs
router.get('/logs', (req, res) => {
  const logs = db.getLogs();
  res.json({ success: true, data: logs });
});

export default router;

