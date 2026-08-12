import fs from 'fs';
import path from 'path';
import { XM360Config, ScheduledOrder, ExecutionLog, AccountConfig } from '../types/index.js';

interface DatabaseSchema {
  config: XM360Config;
  accounts: AccountConfig[];
  activeAccountId: string;
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

        const loadedConfig: XM360Config = { ...DEFAULT_CONFIG, ...(parsed.config || {}) };
        let accountsList: AccountConfig[] = parsed.accounts || [];

        // Ensure at least one account exists if config.accountId is set
        if (accountsList.length === 0 && loadedConfig.accountId) {
          accountsList.push({
            id: `acc-${Date.now()}-1`,
            accountId: loadedConfig.accountId,
            accountName: `MT5 Account ${loadedConfig.accountId}`,
            serverName: loadedConfig.serverName || 'XMGlobal-Real 30',
            platform: loadedConfig.platform || 'MT5',
            password: loadedConfig.password,
            terminalPath: loadedConfig.terminalPath,
            isDefault: true,
          });
        }

        const activeId = parsed.activeAccountId || (accountsList[0] ? accountsList[0].id : '');

        return {
          config: loadedConfig,
          accounts: accountsList,
          activeAccountId: activeId,
          orders: parsed.orders || [],
          logs: parsed.logs || [],
        };
      }
    } catch (err) {
      console.error('Failed to read db file, initializing default:', err);
    }

    const defaultAcc: AccountConfig = {
      id: `acc-default`,
      accountId: DEFAULT_CONFIG.accountId || '50000000',
      accountName: 'Default MT5 Account',
      serverName: DEFAULT_CONFIG.serverName,
      platform: DEFAULT_CONFIG.platform,
      isDefault: true,
    };

    return {
      config: DEFAULT_CONFIG,
      accounts: [defaultAcc],
      activeAccountId: defaultAcc.id,
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

  // Accounts methods
  public getAccounts(): AccountConfig[] {
    return this.data.accounts;
  }

  public getActiveAccountId(): string {
    return this.data.activeAccountId;
  }

  public getActiveAccount(): AccountConfig | undefined {
    return (
      this.data.accounts.find((a) => a.id === this.data.activeAccountId) ||
      this.data.accounts.find((a) => a.accountId === this.data.config.accountId) ||
      this.data.accounts[0]
    );
  }

  public setActiveAccountId(id: string): AccountConfig | undefined {
    const target = this.data.accounts.find((a) => a.id === id || a.accountId === id);
    if (target) {
      this.data.activeAccountId = target.id;
      this.data.config.accountId = target.accountId;
      this.data.config.serverName = target.serverName;
      if (target.password) this.data.config.password = target.password;
      if (target.terminalPath) this.data.config.terminalPath = target.terminalPath;
      this.save();
      return target;
    }
    return undefined;
  }

  public addAccount(accountData: Partial<AccountConfig>): AccountConfig {
    const accId = accountData.accountId ? String(accountData.accountId).trim() : `5000000${this.data.accounts.length + 1}`;
    const newAcc: AccountConfig = {
      id: accountData.id || `acc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      accountId: accId,
      accountName: accountData.accountName || `MT5 Account ${accId}`,
      serverName: accountData.serverName || 'XMGlobal-Real 30',
      platform: accountData.platform || 'MT5',
      password: accountData.password,
      terminalPath: accountData.terminalPath,
      isDefault: this.data.accounts.length === 0,
    };

    // Replace if existing account with same accountId
    const existingIdx = this.data.accounts.findIndex((a) => a.accountId === newAcc.accountId);
    if (existingIdx !== -1) {
      this.data.accounts[existingIdx] = { ...this.data.accounts[existingIdx], ...newAcc };
    } else {
      this.data.accounts.push(newAcc);
    }

    if (!this.data.activeAccountId || this.data.accounts.length === 1) {
      this.data.activeAccountId = newAcc.id;
      this.data.config.accountId = newAcc.accountId;
      this.data.config.serverName = newAcc.serverName;
    }

    this.save();
    return newAcc;
  }

  public updateAccount(id: string, updates: Partial<AccountConfig>): AccountConfig | undefined {
    const idx = this.data.accounts.findIndex((a) => a.id === id || a.accountId === id);
    if (idx !== -1) {
      this.data.accounts[idx] = { ...this.data.accounts[idx], ...updates };
      if (this.data.accounts[idx].id === this.data.activeAccountId) {
        if (updates.accountId) this.data.config.accountId = updates.accountId;
        if (updates.serverName) this.data.config.serverName = updates.serverName;
      }
      this.save();
      return this.data.accounts[idx];
    }
    return undefined;
  }

  public deleteAccount(id: string): boolean {
    const initialLen = this.data.accounts.length;
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id && a.accountId !== id);
    if (this.data.accounts.length !== initialLen) {
      if (this.data.activeAccountId === id && this.data.accounts[0]) {
        this.setActiveAccountId(this.data.accounts[0].id);
      }
      this.save();
      return true;
    }
    return false;
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

