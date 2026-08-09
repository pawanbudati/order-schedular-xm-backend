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

    if (!apiToken || !accountId) {
      // Simulation mode default for UI testing when keys not set
      return {
        asset: 'USD',
        balance: 5000.0,
        equity: 5000.0,
        availableMargin: 5000.0,
        usedMargin: 0.0,
        currency: 'USD',
        marginLevel: 9999.0,
      };
    }

    try {
      const res = await this.client.get(`/users/current/accounts/${accountId}/account-information`, {
        headers: { 'auth-token': apiToken },
      });

      const data = res.data || {};
      const balance = parseFloat(data.balance || '5000');
      const equity = parseFloat(data.equity || data.balance || '5000');
      const freeMargin = parseFloat(data.freeMargin || data.marginFree || '5000');
      const usedMargin = parseFloat(data.margin || '0');

      return {
        asset: data.currency || 'USD',
        balance,
        equity,
        availableMargin: freeMargin,
        usedMargin,
        currency: data.currency || 'USD',
        marginLevel: usedMargin > 0 ? (equity / usedMargin) * 100 : 9999,
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

        if (Array.isArray(res.data)) {
          return res.data.slice(0, 10).map((s: any) => ({
            symbol: s.symbol || s.name,
            lastPrice: parseFloat(s.ask || s.bid || '0'),
            bidPrice: parseFloat(s.bid || '0'),
            askPrice: parseFloat(s.ask || '0'),
            priceChangePercent: parseFloat(s.priceChangePercent || '0.35'),
            high24h: parseFloat(s.high || '0'),
            low24h: parseFloat(s.low || '0'),
            volume24h: parseFloat(s.volume || '1000'),
            spread: parseFloat(s.spread || '0.15'),
          }));
        }
      } catch (err: any) {
        console.warn('Using default XM ticker pair benchmarks');
      }
    }

    // Default XM Popular Trading Pairs (Gold XAUUSD, Forex Majors, Indices)
    return [
      { symbol: 'XAUUSD', lastPrice: 2435.50, bidPrice: 2435.35, askPrice: 2435.65, priceChangePercent: 0.85, high24h: 2448.00, low24h: 2422.10, volume24h: 890500, spread: 0.30 },
      { symbol: 'EURUSD', lastPrice: 1.0925, bidPrice: 1.0924, askPrice: 1.0926, priceChangePercent: -0.15, high24h: 1.0955, low24h: 1.0910, volume24h: 1240100, spread: 0.0002 },
      { symbol: 'GBPUSD', lastPrice: 1.2840, bidPrice: 1.2839, askPrice: 1.2841, priceChangePercent: 0.32, high24h: 1.2875, low24h: 1.2810, volume24h: 650300, spread: 0.0002 },
      { symbol: 'USDJPY', lastPrice: 147.20, bidPrice: 147.19, askPrice: 147.21, priceChangePercent: 0.45, high24h: 147.80, low24h: 146.50, volume24h: 780900, spread: 0.02 },
      { symbol: 'US30', lastPrice: 39450.0, bidPrice: 39448.0, askPrice: 39452.0, priceChangePercent: 0.65, high24h: 39600.0, low24h: 39300.0, volume24h: 420100, spread: 4.0 },
      { symbol: 'US500', lastPrice: 5420.5, bidPrice: 5420.0, askPrice: 5421.0, priceChangePercent: 0.52, high24h: 5440.0, low24h: 5400.0, volume24h: 510200, spread: 1.0 },
      { symbol: 'BTCUSD', lastPrice: 95500.0, bidPrice: 95480.0, askPrice: 95520.0, priceChangePercent: 2.15, high24h: 96200.0, low24h: 94100.0, volume24h: 1540200, spread: 40.0 },
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

    // 2. Simulation Mode when API credentials are not set
    if (!apiToken || !accountId) {
      return {
        success: true,
        orderId: `XM-SIM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        rawResponse: {
          simulated: true,
          platform: 'XM360 MetaTrader',
          symbol: orderParams.symbol,
          lots: orderParams.quantity,
          side: orderParams.side,
          note: 'Executed in XM360 Simulation Mode (Configure Access Token or Local VM Bridge in settings for live execution)',
        },
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
