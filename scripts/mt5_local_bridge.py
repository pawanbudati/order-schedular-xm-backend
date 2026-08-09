"""
XM360 Order Scheduler - 100% Free Local MT5 Python Bridge
Runs locally alongside XM MetaTrader 5 desktop app ($0 Cost / Zero Subscriptions)

Requirements:
    pip install MetaTrader5 Flask
"""

import time
from flask import Flask, request, jsonify

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("⚠️ MetaTrader5 module not installed. Install via: pip install MetaTrader5")

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "mt5_connected": MT5_AVAILABLE and mt5.terminal_info() is not None})

@app.route('/account', methods=['GET'])
def get_account_info():
    if not MT5_AVAILABLE or not mt5.initialize():
        return jsonify({"success": False, "error": "MT5 terminal not connected"}), 500
    
    acc = mt5.account_info()
    if acc is None:
        return jsonify({"success": False, "error": "Failed to fetch account info"}), 500

    return jsonify({
        "success": True,
        "balance": acc.balance,
        "equity": acc.equity,
        "freeMargin": acc.margin_free,
        "usedMargin": acc.margin,
        "currency": acc.currency,
        "marginLevel": acc.margin_level
    })

@app.route('/tickers', methods=['GET'])
def get_tickers():
    if not MT5_AVAILABLE or not mt5.initialize():
        return jsonify({"success": False, "error": "MT5 terminal not connected"}), 500

    symbols = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "US500", "BTCUSD"]
    tickers = []
    for sym in symbols:
        mt5.symbol_select(sym, True)
        tick = mt5.symbol_info_tick(sym)
        if tick:
            tickers.append({
                "symbol": sym,
                "lastPrice": tick.ask,
                "bidPrice": tick.bid,
                "askPrice": tick.ask,
                "priceChangePercent": 0.0,
                "high24h": tick.ask,
                "low24h": tick.bid,
                "volume24h": float(tick.volume),
                "spread": round(tick.ask - tick.bid, 5)
            })
    return jsonify({"success": True, "data": tickers})

@app.route('/trade', methods=['POST'])
def place_trade():
    if not MT5_AVAILABLE:
        return jsonify({"success": False, "error": "MetaTrader5 Python module is not installed."}), 500

    if not mt5.terminal_info():
        if not mt5.initialize():
            return jsonify({"success": False, "error": f"Failed to connect to XM MT5 terminal: {mt5.last_error()}"}), 500

    data = request.json or {}
    symbol = data.get('symbol', 'XAUUSD').upper()
    action = data.get('action', 'BUY').upper()
    volume = float(data.get('volume', 0.01))
    sl = float(data.get('stopLoss', 0)) if data.get('stopLoss') else 0.0
    tp = float(data.get('takeProfit', 0)) if data.get('takeProfit') else 0.0

    # Ensure symbol is selected in Market Watch
    mt5.symbol_select(symbol, True)
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return jsonify({"success": False, "error": f"Symbol {symbol} not found in Market Watch"}), 400

    order_type = mt5.ORDER_TYPE_BUY if action == 'BUY' else mt5.ORDER_TYPE_SELL
    price = tick.ask if action == 'BUY' else tick.bid

    trade_request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 20,
        "magic": 202608,
        "comment": "XM360 Scheduler",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(trade_request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        err_msg = result.comment if result else str(mt5.last_error())
        return jsonify({"success": False, "error": f"MT5 Execution Failed: {err_msg}"}), 400

    return jsonify({
        "success": True,
        "ticket": str(result.order),
        "price": result.price,
        "volume": result.volume,
        "symbol": symbol,
        "action": action
    })

if __name__ == '__main__':
    print("🚀 Starting XM360 Local MT5 Execution Bridge on http://localhost:8080...")
    if MT5_AVAILABLE and mt5.initialize():
        print("✅ Successfully connected to XM MetaTrader 5 Terminal!")
    app.run(host='0.0.0.0', port=8080)
