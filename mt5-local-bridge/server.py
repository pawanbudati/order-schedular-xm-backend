import os
import sys
from flask import Flask, request, jsonify

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    if not mt5:
        return jsonify({"status": "error", "message": "MetaTrader5 Python module not installed."}), 500
    init_ok = mt5.terminal_info() is not None
    return jsonify({"status": "ok", "mt5_connected": init_ok})

@app.route('/connect', methods=['POST'])
def connect():
    if not mt5:
        return jsonify({"success": False, "error": "MetaTrader5 module is not installed on this machine."}), 500
        
    data = request.json or {}
    account = data.get('account')
    password = data.get('password')
    server = data.get('server', 'XMGlobal-Real 30')
    
    if not account or not password:
        return jsonify({"success": False, "error": "Missing account or password credentials."}), 400
        
    try:
        acc_id = int(account)
    except ValueError:
        return jsonify({"success": False, "error": "Account ID must be numeric MT5 account login number."}), 400

    if not mt5.initialize():
        return jsonify({"success": False, "error": f"MT5 terminal initialization failed: {mt5.last_error()}"}), 500
        
    authorized = mt5.login(acc_id, password=password, server=server)
    if authorized:
        acc_info = mt5.account_info()
        return jsonify({
            "success": True,
            "message": f"Successfully connected to native MT5 Account {account} on {server}!",
            "account_id": account,
            "balance": acc_info.balance if acc_info else 0,
            "equity": acc_info.equity if acc_info else 0,
            "currency": acc_info.currency if acc_info else "USD"
        })
    else:
        return jsonify({
            "success": False,
            "error": f"MT5 Login failed for account {account} on server '{server}'. Error: {mt5.last_error()}"
        }), 401

@app.route('/account', methods=['GET'])
def account():
    if not mt5:
        return jsonify({"error": "MetaTrader5 module not installed"}), 500
    if not mt5.terminal_info():
        mt5.initialize()
        
    acc = request.args.get('account')
    pwd = request.args.get('password')
    srv = request.args.get('server', 'XMGlobal-Real 30')
    if acc and pwd:
        try:
            mt5.login(int(acc), password=pwd, server=srv)
        except Exception:
            pass

    acc_info = mt5.account_info()
    if acc_info:
        return jsonify({
            "balance": acc_info.balance,
            "equity": acc_info.equity,
            "margin": acc_info.margin,
            "usedMargin": acc_info.margin,
            "freeMargin": acc_info.margin_free,
            "marginFree": acc_info.margin_free,
            "currency": acc_info.currency,
            "leverage": acc_info.leverage
        })
    return jsonify({"error": "Failed to fetch account info from MT5"}), 500

@app.route('/tickers', methods=['GET'])
def tickers():
    if not mt5:
        return jsonify({"data": []})
    if not mt5.terminal_info():
        mt5.initialize()
    
    # Target trading instrument bases
    target_bases = ["XAUUSD", "GOLD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "US30", "US500", "USTECH", "BTCUSD", "ETHUSD"]
    
    # 1. Discover all available symbols on the logged-in XM account
    all_symbols = mt5.symbols_get()
    selected_symbol_names = []
    
    if all_symbols:
        for s in all_symbols:
            s_name = s.name.upper()
            for base in target_bases:
                if s_name == base or s_name.startswith(base) or (base == "GOLD" and "GOLD" in s_name):
                    if s.name not in selected_symbol_names:
                        selected_symbol_names.append(s.name)
                    break

    # Fallback to standard names if symbols_get returned empty
    if not selected_symbol_names:
        selected_symbol_names = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "US500", "BTCUSD"]

    data = []
    for sym_name in selected_symbol_names[:25]:
        # Enable symbol in Market Watch to start receiving live tick data
        mt5.symbol_select(sym_name, True)
        info = mt5.symbol_info(sym_name)
        tick = mt5.symbol_info_tick(sym_name)
        
        if info:
            ask = tick.ask if (tick and tick.ask > 0) else getattr(info, 'ask', 0)
            bid = tick.bid if (tick and tick.bid > 0) else getattr(info, 'bid', 0)
            last = tick.last if (tick and tick.last > 0) else (ask if ask > 0 else bid)
            
            data.append({
                "symbol": sym_name,
                "lastPrice": last,
                "bidPrice": bid,
                "askPrice": ask,
                "priceChangePercent": 0,
                "high24h": getattr(info, 'high', last),
                "low24h": getattr(info, 'low', last),
                "volume24h": getattr(info, 'volume', 0),
                "spread": getattr(info, 'spread', 0)
            })
            
    return jsonify({"data": data})

@app.route('/trade', methods=['POST'])
def trade():
    if not mt5:
        return jsonify({"success": False, "error": "MetaTrader5 module not installed"}), 500
    if not mt5.terminal_info():
        mt5.initialize()
        
    data = request.json or {}
    symbol = data.get('symbol', 'XAUUSD').upper()
    action = data.get('action', 'BUY').upper()
    volume = float(data.get('volume', 0.01))
    price = data.get('price')
    stop_loss = data.get('stopLoss')
    take_profit = data.get('takeProfit')
    
    symbol_info = mt5.symbol_info(symbol)
    if not symbol_info:
        return jsonify({"success": False, "error": f"Symbol {symbol} not found in MT5"}), 400
        
    if not symbol_info.visible:
        mt5.symbol_select(symbol, True)
        
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return jsonify({"success": False, "error": f"Failed to get live tick price for {symbol}"}), 400

    order_type = mt5.ORDER_TYPE_BUY if action == 'BUY' else mt5.ORDER_TYPE_SELL
    fill_price = tick.ask if action == 'BUY' else tick.bid
    if price:
        fill_price = float(price)

    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": order_type,
        "price": fill_price,
        "deviation": 20,
        "magic": 234000,
        "comment": "XM360 Order Scheduler Execution",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    
    if stop_loss:
        req["sl"] = float(stop_loss)
    if take_profit:
        req["tp"] = float(take_profit)
        
    result = mt5.order_send(req)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        return jsonify({
            "success": True,
            "ticket": result.order,
            "orderId": str(result.order),
            "volume": result.volume,
            "price": result.price
        })
    else:
        err_msg = result.comment if result else f"Error code: {mt5.last_error()}"
        return jsonify({"success": False, "error": f"MT5 order_send failed: {err_msg}"}), 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8555))
    print(f"🚀 MT5 Local Bridge HTTP Server running on http://127.0.0.1:{port}")
    try:
        from waitress import serve
        serve(app, host='0.0.0.0', port=port)
    except ImportError:
        app.run(host='0.0.0.0', port=port)
