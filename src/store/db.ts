import fs from 'fs';
import path from 'path';
import { XM360Config, ScheduledOrder, ExecutionLog } from '../types/index.js';

interface DatabaseSchema {
  config: XM360Config;
  orders: ScheduledOrder[];
  logs: ExecutionLog[];
}

const DB_FILE_PATH = path.resolve(process.cwd(), 'data.json');

const DEFAULT_CONFIG: XM360Config = {
  apiToken: process.env.XM_API_TOKEN || '',
  accountId: process.env.XM_ACCOUNT_ID || '',
  password: process.env.XM_PASSWORD || '',
  serverName: process.env.XM_SERVER_NAME || 'XMGlobal-Real 30',
  platform: (process.env.XM_PLATFORM as 'MT4' | 'MT5') || 'MT5',
  isDemo: true,
  recvWindow: 5000,
};

class Database {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE_PATH)) {
        const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
          orders: parsed.orders || [],
          logs: parsed.logs || [],
        };
      }
    } catch (err) {
      console.error('Failed to read db file, initializing default:', err);
    }
    return {
      config: DEFAULT_CONFIG,
      orders: [],
      logs: [],
    };
  }

  private save(): void {
    try {
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save database file:', err);
    }
  }

  // Config methods
  public getConfig(): XM360Config {
    return this.data.config;
  }

  public updateConfig(newConfig: Partial<XM360Config>): XM360Config {
    this.data.config = { ...this.data.config, ...newConfig };
    this.save();
    return this.data.config;
  }

  // Orders methods
  public getOrders(): ScheduledOrder[] {
    return this.data.orders;
  }

  public getOrderById(id: string): ScheduledOrder | undefined {
    return this.data.orders.find((o) => o.id === id);
  }

  public addOrder(order: ScheduledOrder): ScheduledOrder {
    this.data.orders.unshift(order);
    this.save();
    return order;
  }

  public updateOrder(id: string, updates: Partial<ScheduledOrder>): ScheduledOrder | undefined {
    const index = this.data.orders.findIndex((o) => o.id === id);
    if (index !== -1) {
      this.data.orders[index] = { ...this.data.orders[index], ...updates };
      this.save();
      return this.data.orders[index];
    }
    return undefined;
  }

  public deleteOrder(id: string): boolean {
    const initialLen = this.data.orders.length;
    this.data.orders = this.data.orders.filter((o) => o.id !== id);
    if (this.data.orders.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Logs methods
  public addLog(log: ExecutionLog): void {
    this.data.logs.unshift(log);
    if (this.data.logs.length > 500) {
      this.data.logs = this.data.logs.slice(0, 500); // cap log size
    }
    this.save();
  }

  public getLogs(limit: number = 100): ExecutionLog[] {
    return this.data.logs.slice(0, limit);
  }
}

export const db = new Database();
