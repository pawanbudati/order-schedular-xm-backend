export interface AccountConfig {
  id: string; // Internal account identifier key
  accountId: string; // MT5 Login ID (e.g., "50123456")
  accountName?: string; // Human label (e.g. "XM Real Account 1")
  serverName: string; // e.g. "XMGlobal-Real 30"
  platform: 'MT4' | 'MT5';
  password?: string;
  terminalPath?: string; // Path to terminal64.exe (e.g. C:\Program Files\XM MT5 1\terminal64.exe)
  isDefault?: boolean;
}

export interface XM360Config {
  apiToken: string;
  accountId: string;
  password?: string;
  passcode?: string;
  serverName: string; // e.g. "XMGlobal-Real 30" or "XMGlobal-Demo"
  platform: 'MT4' | 'MT5';
  recvWindow: number;
  terminalPath?: string;
}

export interface XM360ServerTime {
  serverTime: number;
  localTime: number;
  offsetMs: number; // serverTime - localTime
  mt5Connected?: boolean;
}

export interface XM360AccountBalance {
  asset: string;
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  currency?: string;
  marginLevel?: number;
  accountId?: string;
}

export interface XM360Ticker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  bidPrice?: number;
  askPrice?: number;
  spread?: number;
}

export interface ScheduledOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  type: 'MARKET' | 'LIMIT';
  price?: number;
  quantity: number; // Lot size (e.g. 0.01 micro lot, 0.1 mini lot, 1.0 standard lot)
  leverage: number;
  targetTime: number; // UTC timestamp in milliseconds
  stopLoss?: number;
  takeProfit?: number;
  accountId?: string;
  accountName?: string;
  serverName?: string;
  terminalPath?: string;
}

export interface ScheduledOrder extends ScheduledOrderRequest {
  id: string;
  targetTimeFormatted: string;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  actualTime?: number;
  precisionDriftMs?: number;
  xmOrderId?: string;
  brokerOrderId?: string;
  errorMessage?: string;
  createdAt: number;
}

export interface ExecutionLog {
  id: string;
  orderId: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  details?: any;
}

