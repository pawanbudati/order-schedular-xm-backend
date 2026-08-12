import http from 'http';
import axios from 'axios';
import { db } from '../store/db.js';
import { XM360AccountBalance, XM360ServerTime, XM360Ticker } from '../types/index.js';

class XM360Client {
  private httpAgent: http.Agent;
  private serverTimeOffset: number = 0; // serverTime - localTime

  constructor() {
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
  }

  private getAccountId(): string {
    return db.getConfig().accountId || process.env.XM_ACCOUNT_ID || '';
  }

  private getServerName(): string {
    return db.getConfig().serverName || process.env.XM_SERVER_NAME || 'XMGlobal-Real 30';
  }

  private getLocalBridgeBaseUrl(): string {
    const envUrl = process.env.LOCAL_MT5_BRIDGE_URL;
    if (envUrl) return envUrl.replace(/\/$/, '');
    return 'http://127.0.0.1:8555';
  }

  /**
   * Synchronize local clock with Local MT5 Bridge / Broker Time
   */
  public async syncServerTime(): Promise<XM360ServerTime> {
    const localStart = Date.now();
    const localBaseUrl = this.getLocalBridgeBaseUrl();

    try {
      const res = await axios.get(`${localBaseUrl}/health`, { timeout: 2000 });
      const localEnd = Date.now();
      const rtt = localEnd - localStart;
      const serverTime = res.data?.timestamp || Date.now();
      const adjustedServerTime = serverTime + Math.round(rtt / 2);
      this.serverTimeOffset = adjustedServerTime - localEnd;

      const isConnected = res.data?.status === 'ok' || res.data?.mt5_connected === true;
      return {
        serverTime: adjustedServerTime,
        localTime: localEnd,
        offsetMs: this.serverTimeOffset,
        mt5Connected: isConnected,
      };
    } catch {
      // Local bridge offline or standby
    }

    return {
      serverTime: Date.now(),
      localTime: Date.now(),
      offsetMs: 0,
      mt5Connected: false,
    };
  }

  public getServerTimeOffset(): number {
    return this.serverTimeOffset;
  }

  /**
   * Connect to Local MT5 Native Terminal Bridge
   */
  public async connectLocalBridge(accParams?: {
    accountId?: string;
    serverName?: string;
    terminalPath?: string;
    password?: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    const activeAcc = db.getActiveAccount();
    const accountId = accParams?.accountId || activeAcc?.accountId || this.getAccountId();
    const server = accParams?.serverName || activeAcc?.serverName || this.getServerName();
    const path = accParams?.terminalPath || activeAcc?.terminalPath;
    const password = accParams?.password || activeAcc?.password;

    try {
      const res = await axios.post(
        `${localBaseUrl}/connect`,
        { accountId, server, path, password },
        { timeout: 6000 }
      );

      if (res.data && res.data.success) {
        return {
          success: true,
          message: res.data.message || `Successfully attached to active MT5 Account ${res.data.account_id || ''}!`,
          details: res.data,
        };
      } else {
        return {
          success: false,
          message: res.data?.error || 'MT5 Local Bridge connection failed.',
          details: res.data,
        };
      }
    } catch (err: any) {
      const bridgeErr = err.response?.data?.error || err.response?.data?.message || err.message;
      return {
        success: false,
        message: `MT5 Local Bridge Error (${localBaseUrl}): ${bridgeErr}. Ensure MT5 app is open on the machine and Python bridge is running on port 8555.`,
        details: err.response?.data,
      };
    }
  }

  /**
   * Fetch list of running / configured MT5 terminal instances from local bridge
   */
  public async getDetectedInstances(): Promise<{ success: boolean; instances: any[]; configured_paths?: string[] }> {
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    try {
      const res = await axios.get(`${localBaseUrl}/instances`, { timeout: 6000 });
      return {
        success: true,
        instances: res.data?.instances || [],
        configured_paths: res.data?.configured_paths || [],
      };
    } catch {
      return { success: false, instances: [] };
    }
  }

  /**
   * Get XM Account Balance, Equity, & Free Margin from Local MT5 Bridge for target account
   */
  public async getAccountBalance(accId?: string): Promise<XM360AccountBalance> {
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    const activeAcc = db.getAccounts().find((a) => a.id === accId || a.accountId === accId) || db.getActiveAccount();
    const targetAccountId = accId || activeAcc?.accountId || this.getAccountId();
    const path = activeAcc?.terminalPath;
    const server = activeAcc?.serverName;

    try {
      const localRes = await axios.get(`${localBaseUrl}/account`, {
        params: { accountId: targetAccountId, path, server },
        timeout: 5000,
      });

      if (localRes.data && (localRes.data.balance !== undefined || localRes.data.equity !== undefined)) {
        const b = parseFloat(localRes.data.balance || '0');
        const e = parseFloat(localRes.data.equity || localRes.data.balance || '0');
        const fm = parseFloat(localRes.data.freeMargin || localRes.data.marginFree || '0');
        const um = parseFloat(localRes.data.usedMargin || localRes.data.margin || '0');
        return {
          asset: localRes.data.currency || 'USD',
          balance: b,
          equity: e,
          availableMargin: fm,
          usedMargin: um,
          currency: localRes.data.currency || 'USD',
          marginLevel: um > 0 ? (e / um) * 100 : 0,
          accountId: localRes.data.account_id || targetAccountId,
        };
      }
    } catch (err: any) {
      console.warn(`Local MT5 bridge /account fetch note (${localBaseUrl}):`, err.message);
    }

    return {
      asset: 'USD',
      balance: 0,
      equity: 0,
      availableMargin: 0,
      usedMargin: 0,
      currency: 'USD',
      marginLevel: 0,
      accountId: targetAccountId,
    };
  }

  /**
   * Fetch Live XM FX & Commodity Tickers from Local MT5 Bridge
   */
  public async getTickers(accId?: string): Promise<XM360Ticker[]> {
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    const activeAcc = db.getAccounts().find((a) => a.id === accId || a.accountId === accId) || db.getActiveAccount();
    const targetAccountId = accId || activeAcc?.accountId;
    const path = activeAcc?.terminalPath;
    const server = activeAcc?.serverName;

    try {
      const localRes = await axios.get(`${localBaseUrl}/tickers`, {
        params: { accountId: targetAccountId, path, server },
        timeout: 5000,
      });
      if (localRes.data && Array.isArray(localRes.data.data) && localRes.data.data.length > 0) {
        return localRes.data.data;
      }
    } catch (err: any) {
      console.warn(`Local MT5 bridge /tickers fetch note (${localBaseUrl}):`, err.message);
    }

    // Standard XM Supported Instruments fallback
    return [
      { symbol: 'XAUUSD', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
      { symbol: 'EURUSD', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
      { symbol: 'GBPUSD', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
      { symbol: 'USDJPY', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
      { symbol: 'US30', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
      { symbol: 'US500', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
      { symbol: 'BTCUSD', lastPrice: 0, bidPrice: 0, askPrice: 0, priceChangePercent: 0, high24h: 0, low24h: 0, volume24h: 0, spread: 0 },
    ];
  }

  /**
   * Execute Scheduled Order on Local MT5 Native Terminal
   */
  public async placeOrder(orderParams: {
    symbol: string;
    side: 'BUY' | 'SELL';
    positionSide?: 'LONG' | 'SHORT' | 'BOTH';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
    accountId?: string;
    serverName?: string;
    terminalPath?: string;
  }): Promise<{ success: boolean; orderId?: string; rawResponse?: any; error?: string }> {
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    const tradeUrl = `${localBaseUrl}/trade`;

    const activeAcc = db.getAccounts().find((a) => a.accountId === orderParams.accountId || a.id === orderParams.accountId) || db.getActiveAccount();
    const targetAccountId = orderParams.accountId || activeAcc?.accountId;
    const targetServer = orderParams.serverName || activeAcc?.serverName;
    const targetPath = orderParams.terminalPath || activeAcc?.terminalPath;
    const password = activeAcc?.password;

    try {
      const res = await axios.post(
        tradeUrl,
        {
          symbol: orderParams.symbol,
          action: orderParams.side,
          type: orderParams.type,
          volume: orderParams.quantity,
          price: orderParams.price,
          stopLoss: orderParams.stopLoss,
          takeProfit: orderParams.takeProfit,
          accountId: targetAccountId,
          server: targetServer,
          path: targetPath,
          password,
        },
        { timeout: 5000 }
      );

      if (res.data && (res.data.success || res.data.ticket || res.data.orderId)) {
        return {
          success: true,
          orderId: res.data?.ticket || res.data?.orderId || `LOCAL-${Date.now()}`,
          rawResponse: res.data,
        };
      } else {
        return {
          success: false,
          error: res.data?.error || 'Local MT5 order execution failed.',
          rawResponse: res.data,
        };
      }
    } catch (err: any) {
      if (err.response && err.response.data && err.response.data.error) {
        return {
          success: false,
          error: err.response.data.error,
          rawResponse: err.response.data,
        };
      }

      return {
        success: false,
        error: `MT5 Local Bridge Connection Error (${tradeUrl}): ${err.message}. Ensure Python bridge is running on port 8555.`,
        rawResponse: err.response?.data,
      };
    }
  }
}

export const xm360Client = new XM360Client();

