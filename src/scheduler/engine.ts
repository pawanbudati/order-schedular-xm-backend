import { xm360Client } from '../xm360/client.js';
import { db } from '../store/db.js';
import { ScheduledOrder } from '../types/index.js';

class HighPrecisionSchedulerEngine {
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized: boolean = false;

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.log('🚀 Initializing High-Precision XM360 Scheduler Engine...');

    // Sync XM server clock
    const clockSync = await xm360Client.syncServerTime();
    console.log(`⏱️ XM Broker Clock Synced: Offset = ${clockSync.offsetMs} ms (Server: ${clockSync.serverTime}, Local: ${clockSync.localTime})`);

    // Periodically re-sync clock every 5 minutes
    setInterval(async () => {
      await xm360Client.syncServerTime();
    }, 5 * 60 * 1000);

    // Reload pending orders from store
    const pendingOrders = db.getOrders().filter((o) => o.status === 'PENDING');
    console.log(`📋 Loaded ${pendingOrders.length} pending orders from persistent database.`);

    for (const order of pendingOrders) {
      this.scheduleOrder(order);
    }
  }

  /**
   * Schedule an order for precise execution at targetTime (UTC Milliseconds)
   */
  public scheduleOrder(order: ScheduledOrder): void {
    // Clear existing timer if re-scheduling
    this.cancelTimer(order.id);

    const nowLocal = Date.now();
    const offset = xm360Client.getServerTimeOffset();
    // Calculate expected local machine timestamp when server timestamp equals order.targetTime
    const localTargetMs = order.targetTime - offset;
    const delayMs = localTargetMs - nowLocal;

    if (delayMs <= 0) {
      console.warn(`Order ${order.id} target time is in the past (${delayMs} ms overdue). Executing immediately.`);
      this.executeOrderNow(order);
      return;
    }

    console.log(`⏰ Order ${order.id} (${order.symbol} ${order.side} ${order.quantity} Lots) scheduled in ${delayMs} ms at target ${order.targetTimeFormatted}`);

    db.addLog({
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      orderId: order.id,
      timestamp: Date.now(),
      level: 'INFO',
      message: `Order scheduled for ${order.targetTimeFormatted} (Delay: ${delayMs}ms)`,
    });

    // 2-Stage High Precision Timer:
    // Stage 1: If delay is > 50ms, sleep with setTimeout until 50ms before target.
    // Stage 2: Spin-lock with high-resolution process.hrtime.bigint() for final 50ms.
    if (delayMs > 50) {
      const macroTimer = setTimeout(() => {
        this.spinAndExecute(order);
      }, delayMs - 50);

      this.activeTimers.set(order.id, macroTimer);
    } else {
      this.spinAndExecute(order);
    }
  }

  /**
   * Stage 2 Spin-Lock for microsecond/millisecond alignment
   */
  private spinAndExecute(order: ScheduledOrder): void {
    const offset = xm360Client.getServerTimeOffset();
    const targetServerMs = order.targetTime;

    // High-resolution spin loop for final 50ms alignment
    const spinStart = process.hrtime.bigint();
    while (true) {
      const currentServerMs = Date.now() + offset;
      if (currentServerMs >= targetServerMs) {
        break;
      }
      // Brief yield if > 2ms remaining to prevent 100% CPU lockup during longer spins
      const remainingMs = targetServerMs - currentServerMs;
      if (remainingMs > 5) {
        const start = Date.now();
        while (Date.now() - start < 1) {}
      }
    }

    const spinEnd = process.hrtime.bigint();
    const spinDurationUs = Number(spinEnd - spinStart) / 1000;

    // Trigger order placement immediately
    this.executeOrderNow(order, spinDurationUs);
  }

  /**
   * Dispatches order execution to XM360 API and records metrics
   */
  private async executeOrderNow(order: ScheduledOrder, spinDurationUs: number = 0): Promise<void> {
    this.activeTimers.delete(order.id);

    // Update status to EXECUTING
    db.updateOrder(order.id, { status: 'EXECUTING' });

    const triggerLocalTime = Date.now();
    const triggerServerTime = triggerLocalTime + xm360Client.getServerTimeOffset();
    const driftMs = triggerServerTime - order.targetTime;

    console.log(`⚡ EXECUTING ORDER ${order.id} on XM360! (Target: ${order.targetTime}, TriggerServerTime: ${triggerServerTime}, Drift: ${driftMs > 0 ? '+' : ''}${driftMs}ms)`);

    db.addLog({
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      orderId: order.id,
      timestamp: triggerLocalTime,
      level: 'INFO',
      message: `Triggering XM360 API execution (Drift: ${driftMs > 0 ? '+' : ''}${driftMs}ms, Spin: ${spinDurationUs.toFixed(1)}µs)`,
    });

    try {
      const result = await xm360Client.placeOrder({
        symbol: order.symbol,
        side: order.side,
        positionSide: order.positionSide,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        leverage: order.leverage,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        accountId: order.accountId,
        serverName: order.serverName,
        terminalPath: order.terminalPath,
      });

      const completionTime = Date.now();

      if (result.success) {
        db.updateOrder(order.id, {
          status: 'COMPLETED',
          actualTime: completionTime,
          precisionDriftMs: driftMs,
          xmOrderId: result.orderId,
          brokerOrderId: result.orderId,
        });

        db.addLog({
          id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          orderId: order.id,
          timestamp: completionTime,
          level: 'SUCCESS',
          message: `Order filled on XM360! Order Ticket: ${result.orderId} (Drift: ${driftMs > 0 ? '+' : ''}${driftMs}ms)`,
          details: result.rawResponse,
        });
        console.log(`✅ Order ${order.id} SUCCESS. XM Ticket: ${result.orderId}`);
      } else {
        db.updateOrder(order.id, {
          status: 'FAILED',
          actualTime: completionTime,
          precisionDriftMs: driftMs,
          errorMessage: result.error || 'Unknown XM360 Execution Error',
        });

        db.addLog({
          id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          orderId: order.id,
          timestamp: completionTime,
          level: 'ERROR',
          message: `XM360 Execution Failed: ${result.error}`,
          details: result.rawResponse,
        });
        console.error(`❌ Order ${order.id} FAILED: ${result.error}`);
      }
    } catch (err: any) {
      const errTime = Date.now();
      db.updateOrder(order.id, {
        status: 'FAILED',
        actualTime: errTime,
        precisionDriftMs: driftMs,
        errorMessage: err.message,
      });

      db.addLog({
        id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        orderId: order.id,
        timestamp: errTime,
        level: 'ERROR',
        message: `Exception during order execution: ${err.message}`,
      });
    }
  }

  /**
   * Cancel a pending order
   */
  public cancelOrder(orderId: string): boolean {
    this.cancelTimer(orderId);
    const updated = db.updateOrder(orderId, { status: 'CANCELLED' });

    if (updated) {
      db.addLog({
        id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        orderId,
        timestamp: Date.now(),
        level: 'WARN',
        message: `Order ${orderId} was cancelled by user.`,
      });
      return true;
    }
    return false;
  }

  private cancelTimer(orderId: string): void {
    const existing = this.activeTimers.get(orderId);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(orderId);
    }
  }
}

export const schedulerEngine = new HighPrecisionSchedulerEngine();
