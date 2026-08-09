import http from 'http';
import https from 'https';
import axios, { AxiosInstance } from 'axios';
import { db } from '../store/db.js';
import { XM360AccountBalance, XM360ServerTime, XM360Ticker } from '../types/index.js';

class XM360Client {
  private httpAgent: http.Agent;
  private httpsAgent: https.Agent;
  private client: AxiosInstance;
  private serverTimeOffset: number = 0; // serverTime - localTime

  constructor() {
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
    this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

    this.client = axios.create({
      baseURL: process.env.XM_API_BASE_URL || 'https://mt-client-api.agium.cloud',
      timeout: 10000,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
  }

  private getApiToken(): string {
    return db.getConfig().apiToken || process.env.XM_API_TOKEN || '';
  }

  private getAccountId(): string {
    return db.getConfig().accountId || process.env.XM_ACCOUNT_ID || '';
  }

  private getServerName(): string {
    return db.getConfig().serverName || process.env.XM_SERVER_NAME || 'XMGlobal-Real 30';
  }

  /**
   * Synchronize local clock with XM Broker / Server Time
   */
  public async syncServerTime(): Promise<XM360ServerTime> {
    const localStart = Date.now();
    try {
      const apiToken = this.getApiToken();
      const accountId = this.getAccountId();

      if (apiToken && accountId) {
        const res = await this.client.get(`/users/current/accounts/${accountId}/time`, {
          headers: { 'auth-token': apiToken },
        });
        const localEnd = Date.now();
        const rtt = localEnd - localStart;
        const serverTime = res.data?.serverTime ? new Date(res.data.serverTime).getTime() : Date.now();
        const adjustedServerTime = serverTime + Math.round(rtt / 2);
        this.serverTimeOffset = adjustedServerTime - localEnd;

        return {
          serverTime: adjustedServerTime,
          localTime: localEnd,
          offsetMs: this.serverTimeOffset,
        };
      }
    } catch (err: any) {
      console.warn('XM server time sync note (using local time offset):', err.message);
    }

    return {
      serverTime: Date.now(),
      localTime: Date.now(),
      offsetMs: 0,
    };
  }

  public getServerTimeOffset(): number {
    return this.serverTimeOffset;
  }

  private getLocalBridgeBaseUrl(): string {
    const envUrl = process.env.LOCAL_MT5_BRIDGE_URL;
    if (envUrl) return envUrl.replace(/\/$/, '');
    const token = this.getApiToken();
    if (token && token.startsWith('http')) return token.replace(/\/$/, '');
    return 'http://127.0.0.1:8555';
  }

  public async connectLocalBridge(): Promise<boolean> {
    const config = db.getConfig();
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    if (!config.accountId || !config.password) return false;

    try {
      const res = await axios.post(`${localBaseUrl}/connect`, {
        account: config.accountId,
        password: config.password,
        server: config.serverName || 'XMGlobal-Real 30',
      }, { timeout: 4000 });
      return Boolean(res.data?.success);
    } catch {
      return false;
    }
  }

  /**
   * Get XM Account Balance, Equity, & Free Margin
   */
  public async getAccountBalance(): Promise<XM360AccountBalance> {
    const apiToken = this.getApiToken();
    const accountId = this.getAccountId();
    const config = db.getConfig();
    const localBaseUrl = this.getLocalBridgeBaseUrl();

    // 1. Try Local MT5 Bridge first if running
    try {
      const localRes = await axios.get(`${localBaseUrl}/account`, {
        params: {
          account: accountId,
          password: config.password,
          server: config.serverName,
        },
        timeout: 2500
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
        };
      }
    } catch {
      // Local bridge not active or /account not implemented yet, fallback to MetaApi cloud
    }

    if (!apiToken && !accountId) {
      throw new Error('No XM MetaTrader account configured. Please click API Settings to connect your account.');
    }

    try {
      const res = await this.client.get(`/users/current/accounts/${accountId}/account-information`, {
        headers: { 'auth-token': apiToken },
      });

      const data = res.data || {};
      const balance = parseFloat(data.balance || '0');
      const equity = parseFloat(data.equity || data.balance || '0');
      const freeMargin = parseFloat(data.freeMargin || data.marginFree || '0');
      const usedMargin = parseFloat(data.margin || '0');

      return {
        asset: data.currency || 'USD',
        balance,
        equity,
        availableMargin: freeMargin,
        usedMargin,
        currency: data.currency || 'USD',
        marginLevel: usedMargin > 0 ? (equity / usedMargin) * 100 : 0,
      };
    } catch (err: any) {
      // If balance fetch fails, return zeroed balance object so UI remains functional
      return {
        asset: 'USD',
        balance: 0,
        equity: 0,
        availableMargin: 0,
        usedMargin: 0,
        currency: 'USD',
        marginLevel: 0,
      };
    }
  }

  /**
   * Fetch Live XM FX & Commodity Tickers (Gold XAUUSD, Forex, Indices)
   */
  public async getTickers(): Promise<XM360Ticker[]> {
    const apiToken = this.getApiToken();
    const accountId = this.getAccountId();
    const localBaseUrl = this.getLocalBridgeBaseUrl();

    // 1. Try Local MT5 Bridge tickers
    try {
      const localRes = await axios.get(`${localBaseUrl}/tickers`, { timeout: 2500 });
      if (localRes.data && Array.isArray(localRes.data.data) && localRes.data.data.length > 0) {
        return localRes.data.data;
      }
    } catch {
      // Local bridge not active, fallback to MetaApi cloud
    }

    if (apiToken && accountId) {
      try {
        const res = await this.client.get(`/users/current/accounts/${accountId}/symbols`, {
          headers: { 'auth-token': apiToken },
        });

        if (Array.isArray(res.data) && res.data.length > 0) {
          return res.data.slice(0, 10).map((s: any) => ({
            symbol: s.symbol || s.name,
            lastPrice: parseFloat(s.ask || s.bid || '0'),
            bidPrice: parseFloat(s.bid || '0'),
            askPrice: parseFloat(s.ask || '0'),
            priceChangePercent: parseFloat(s.priceChangePercent || '0'),
            high24h: parseFloat(s.high || '0'),
            low24h: parseFloat(s.low || '0'),
            volume24h: parseFloat(s.volume || '0'),
            spread: parseFloat(s.spread || '0'),
          }));
        }
      } catch (err: any) {
        console.warn('XM Ticker fetch notice:', err.message);
      }
    }

    // Standard XM Supported Instruments
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
   * Execute Scheduled Order on XM / MetaTrader Platform
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
  }): Promise<{ success: boolean; orderId?: string; rawResponse?: any; error?: string }> {
    const apiToken = this.getApiToken();
    const accountId = this.getAccountId();
    const localBaseUrl = this.getLocalBridgeBaseUrl();
    const tradeUrl = `${localBaseUrl}/trade`;

    const config = db.getConfig();
    // 1. Try Local MT5 Execution Bridge
    try {
      const res = await axios.post(tradeUrl, {
        symbol: orderParams.symbol,
        action: orderParams.side,
        type: orderParams.type,
        volume: orderParams.quantity,
        price: orderParams.price,
        stopLoss: orderParams.stopLoss,
        takeProfit: orderParams.takeProfit,
        account: accountId,
        password: config.password,
        server: config.serverName,
      }, { timeout: 5000 });

      if (res.data && (res.data.success || res.data.ticket || res.data.orderId)) {
        return {
          success: true,
          orderId: res.data?.ticket || res.data?.orderId || `LOCAL-${Date.now()}`,
          rawResponse: res.data,
        };
      }
    } catch (err: any) {
      console.warn('Local MT5 bridge execution attempt notice:', err.message);
    }

    // 2. MetaApi Cloud REST API Fallback
    if (apiToken && !apiToken.startsWith('http') && apiToken !== 'LOCAL') {
      try {
        const res = await this.client.post(`/users/current/accounts/${accountId}/trade`, {
          symbol: orderParams.symbol,
          actionType: orderParams.side === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
          volume: orderParams.quantity,
          openPrice: orderParams.price,
          stopLoss: orderParams.stopLoss,
          takeProfit: orderParams.takeProfit,
        }, {
          headers: { 'auth-token': apiToken },
        });

        return {
          success: true,
          orderId: res.data?.numericCode || res.data?.stringCode || `METAAPI-${Date.now()}`,
          rawResponse: res.data,
        };
      } catch (err: any) {
        return {
          success: false,
          error: `MetaApi Cloud Execution Error: ${err.response?.data?.message || err.message}`,
          rawResponse: err.response?.data,
        };
      }
    }

    return {
      success: false,
      error: `MT5 Bridge Connection Refused at ${tradeUrl}. Ensure MT5 Bridge (python scripts/mt5_local_bridge.py or Docker container) is active on port 8080, or enter a valid MetaApi Token in API Settings.`,
    };
  }
}

export const xm360Client = new XM360Client();
