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

  /**
   * Get XM Account Balance, Equity, & Free Margin
   */
  public async getAccountBalance(): Promise<XM360AccountBalance> {
    const apiToken = this.getApiToken();
    const accountId = this.getAccountId();

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
      console.error('XM360 getAccountBalance error:', err.response?.data || err.message);
      throw new Error(err.response?.data?.message || err.message || 'Failed to fetch XM account balance');
    }
  }

  /**
   * Fetch Live XM FX & Commodity Tickers (Gold XAUUSD, Forex, Indices)
   */
  public async getTickers(): Promise<XM360Ticker[]> {
    const apiToken = this.getApiToken();
    const accountId = this.getAccountId();

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

    // Standard XM Supported Instruments (without fake mock prices)
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
   * Execute Scheduled Order on XM / MetaTrader Platform (supports Cloud API and Local VM MT5 Bridge)
   */
  public async placeOrder(orderParams: {
    symbol: string;
    side: 'BUY' | 'SELL';
    positionSide?: 'LONG' | 'SHORT' | 'BOTH';
    type: 'MARKET' | 'LIMIT';
    quantity: number; // Lot size e.g. 0.01, 0.1, 1.0
    price?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<{ success: boolean; orderId?: string; rawResponse?: any; error?: string }> {
    const apiToken = this.getApiToken();
    const accountId = this.getAccountId();
    const localBridgeUrl = process.env.LOCAL_MT5_BRIDGE_URL || (apiToken.startsWith('http') ? apiToken : null);

    // 1. Local GCP VM MT5 Bridge Mode (100% Free local execution via Wine/Docker EA)
    if (localBridgeUrl || apiToken === 'LOCAL' || apiToken === 'LOCAL_EA') {
      try {
        const targetUrl = localBridgeUrl || 'http://localhost:8080/trade';
        const res = await axios.post(targetUrl, {
          symbol: orderParams.symbol,
          action: orderParams.side,
          type: orderParams.type,
          volume: orderParams.quantity,
          price: orderParams.price,
          stopLoss: orderParams.stopLoss,
          takeProfit: orderParams.takeProfit,
          account: accountId,
        }, { timeout: 5000 });

        return {
          success: true,
          orderId: res.data?.ticket || res.data?.orderId || `LOCAL-${Date.now()}`,
          rawResponse: res.data,
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Local VM MT5 Bridge Error: ${err.message}. Ensure MT5 EA is running on http://localhost:8080.`,
          rawResponse: err.response?.data,
        };
      }
    }

    // 2. Error if API credentials are not set
    if (!apiToken && !accountId) {
      return {
        success: false,
        error: 'Cannot execute order: No XM MetaTrader account configured. Please click API Settings to connect your account.',
      };
    }

    // 3. MetaApi Cloud REST API Mode
    try {
      const actionType = orderParams.type === 'LIMIT'
        ? (orderParams.side === 'BUY' ? 'ORDER_TYPE_BUY_LIMIT' : 'ORDER_TYPE_SELL_LIMIT')
        : (orderParams.side === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL');

      const reqBody: Record<string, any> = {
        actionType,
        symbol: orderParams.symbol,
        volume: orderParams.quantity, // Lot size
      };

      if (orderParams.type === 'LIMIT' && orderParams.price) {
        reqBody.openPrice = orderParams.price;
      }

      if (orderParams.stopLoss) {
        reqBody.stopLoss = orderParams.stopLoss;
      }

      if (orderParams.takeProfit) {
        reqBody.takeProfit = orderParams.takeProfit;
      }

      const res = await this.client.post(`/users/current/accounts/${accountId}/trade`, reqBody, {
        headers: { 'auth-token': apiToken },
      });

      if (res.data && (res.data.numericCode === 10009 || res.data.stringCode === 'TRADE_RETCODE_DONE' || res.data.orderId)) {
        const orderId = res.data.orderId || res.data.numericCode || `XM-${Date.now()}`;
        return {
          success: true,
          orderId: String(orderId),
          rawResponse: res.data,
        };
      } else {
        return {
          success: false,
          error: res.data?.message || res.data?.stringCode || 'Failed to place order on XM platform',
          rawResponse: res.data,
        };
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Network/Server Error placing XM order';
      return {
        success: false,
        error: errMsg,
        rawResponse: err.response?.data,
      };
    }
  }
}

export const xm360Client = new XM360Client();
