import os
import sys
from flask import Flask, request, jsonify

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

app = Flask(__name__)

def is_tradable(info):
    if not info:
        return False
    # Check if symbol trade mode is not disabled (SYMBOL_TRADE_MODE_DISABLED == 0)
    if hasattr(info, 'trade_mode') and info.trade_mode == mt5.SYMBOL_TRADE_MODE_DISABLED:
        return False
    return True

def resolve_mt5_symbol(requested_symbol: str):
    if not mt5 or not requested_symbol:
        return requested_symbol, None
        
    raw = requested_symbol.strip()
    
    # 1. Try exact requested symbol name first if tradable
    mt5.symbol_select(raw, True)
    info = mt5.symbol_info(raw)
    if info and is_tradable(info):
        return raw, info

    # 2. Try exact case variations (upper / lower) if tradable
    for name in [raw.upper(), raw.lower()]:
        mt5.symbol_select(name, True)
        info = mt5.symbol_info(name)
        if info and is_tradable(info):
            return name, info

    # 3. Search across all MT5 broker symbols for active tradable variation (e.g. AUDUSD.i#, AUDUSD.m, XAUUSD.m)
    all_symbols = mt5.symbols_get()
    fallback_info = None
    fallback_name = raw
    
    if all_symbols:
        req_clean = raw.upper().replace('.', '').replace('#', '').replace('_', '')
        for s in all_symbols:
            s_name = s.name
            s_clean = s_name.upper().replace('.', '').replace('#', '').replace('_', '')
            if s_name.upper() == raw.upper() or s_clean == req_clean or s_clean.startswith(req_clean) or req_clean.startswith(s_clean):
                if is_tradable(s):
                    mt5.symbol_select(s_name, True)
                    info = mt5.symbol_info(s_name)
                    if info and is_tradable(info):
                        return s_name, info
                elif not fallback_info:
                    mt5.symbol_select(s_name, True)
                    fallback_info = mt5.symbol_info(s_name)
                    fallback_name = s_name

    return fallback_name, fallback_info

@app.route('/health', methods=['GET'])
def health():
    if not mt5:
        return jsonify({"status": "error", "message": "MetaTrader5 Python module not installed."}), 500
    init_ok = mt5.terminal_info() is not None
    return jsonify({"status": "ok", "mt5_connected": init_ok})

@app.route('/connect', methods=['POST', 'GET'])
def connect():
    if not mt5:
        return jsonify({"success": False, "error": "MetaTrader5 module is not installed on this machine."}), 500

    if not mt5.terminal_info():
        if not mt5.initialize():
            return jsonify({"success": False, "error": f"MT5 terminal initialization failed: {mt5.last_error()}. Ensure MT5 app is open on the machine."}), 500
        
    acc_info = mt5.account_info()
    if acc_info:
        return jsonify({
            "success": True,
            "message": f"Successfully attached to active MT5 Account {acc_info.login} on {acc_info.server}!",
            "account_id": str(acc_info.login),
            "server": acc_info.server,
            "balance": acc_info.balance,
            "equity": acc_info.equity,
            "currency": acc_info.currency
        })
    else:
        return jsonify({
            "success": False,
            "error": "Failed to fetch account info. Ensure MetaTrader 5 terminal is open and logged in."
        }), 400

@app.route('/account', methods=['GET'])
def account():
    if not mt5:
        return jsonify({"error": "MetaTrader5 module not installed"}), 500
    if not mt5.terminal_info():
        mt5.initialize()

    acc_info = mt5.account_info()
    if acc_info:
        return jsonify({
            "account_id": str(acc_info.login),
            "server": acc_info.server,
            "balance": acc_info.balance,
            "equity": acc_info.equity,
            "margin": acc_info.margin,
            "usedMargin": acc_info.margin,
            "freeMargin": acc_info.margin_free,
            "marginFree": acc_info.margin_free,
            "currency": acc_info.currency,
            "leverage": acc_info.leverage
        })
    return jsonify({"error": "Failed to fetch account info from MT5 terminal"}), 500

@app.route('/tickers', methods=['GET'])
def tickers():
    if not mt5:
        return jsonify({"data": []})
    if not mt5.terminal_info():
        mt5.initialize()
    
    target_bases = ["XAUUSD", "GOLD.I#", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "US30", "US500", "USTECH", "BTCUSD", "ETHUSD"]

    
    all_symbols = mt5.symbols_get()
    selected_symbol_names = []
    
    if all_symbols:
        for s in all_symbols:
            if not is_tradable(s):
                continue
            s_name = s.name
            s_upper = s_name.upper()
            for base in target_bases:
                if s_upper == base or s_upper.startswith(base) or (base == "GOLD.I#" and "GOLD.I#" in s_upper):
                    if s_name not in selected_symbol_names:
                        selected_symbol_names.append(s_name)
                    break

    if not selected_symbol_names:
        selected_symbol_names = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "US500", "BTCUSD"]

    # Ensure Gold symbols (XAUUSD / GOLD) are sorted first at top of list
    selected_symbol_names.sort(key=lambda s: 0 if ("XAU" in s.upper() or "GOLD" in s.upper()) else 1)

    data = []

    for sym_name in selected_symbol_names[:25]:
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
    raw_symbol = str(data.get('symbol', 'XAUUSD')).strip()
    action = str(data.get('action', 'BUY')).upper()
    volume = float(data.get('volume', 0.01))
    price = data.get('price')
    stop_loss = data.get('stopLoss')
    take_profit = data.get('takeProfit')

    # Smart MT5 Symbol Resolver (handles GOLD.i#, AUDUSD.i#, XAUUSD.m, etc. checking active trade_mode)
    real_symbol, symbol_info = resolve_mt5_symbol(raw_symbol)
    if not symbol_info:
        return jsonify({"success": False, "error": f"Symbol '{raw_symbol}' not found in MT5 Market Watch."}), 400

    mt5.symbol_select(real_symbol, True)
    tick = mt5.symbol_info_tick(real_symbol)
    if not tick:
        return jsonify({"success": False, "error": f"Failed to get live tick price for symbol '{real_symbol}'"}), 400

    order_type = mt5.ORDER_TYPE_BUY if action == 'BUY' else mt5.ORDER_TYPE_SELL
    fill_price = tick.ask if action == 'BUY' else tick.bid
    if price:
        fill_price = float(price)

    # Detect execution filling mode supported by the symbol with automatic fallback
    filling_modes = []
    if hasattr(symbol_info, 'filling_mode') and symbol_info.filling_mode:
        fm = symbol_info.filling_mode
        if fm & mt5.ORDER_FILLING_FOK:
            filling_modes.append(mt5.ORDER_FILLING_FOK)
        if fm & mt5.ORDER_FILLING_IOC:
            filling_modes.append(mt5.ORDER_FILLING_IOC)
        if fm & mt5.ORDER_FILLING_RETURN:
            filling_modes.append(mt5.ORDER_FILLING_RETURN)

    # Fallback to trying all filling modes in priority order if symbol_info flags were ambiguous
    for default_mode in [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]:
        if default_mode not in filling_modes:
            filling_modes.append(default_mode)

    last_error = ""
    for f_mode in filling_modes:
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": real_symbol,
            "volume": volume,
            "type": order_type,
            "price": fill_price,
            "deviation": 20,
            "magic": 234000,
            "comment": "XM360 Order Scheduler",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": f_mode,
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
        elif result and ("filling" in str(result.comment).lower() or result.retcode in [10027, 10030]):
            last_error = f"{result.comment} (retcode: {result.retcode})"
            print(f"[WARNING] Filling mode {f_mode} rejected for {real_symbol}: {last_error}. Retrying with next filling mode...")
            continue
        else:
            err_msg = result.comment if result else f"Error code: {mt5.last_error()}"
            return jsonify({"success": False, "error": f"MT5 order_send failed for {real_symbol}: {err_msg}"}), 400

    return jsonify({"success": False, "error": f"MT5 order_send failed for {real_symbol}: {last_error}"}), 400

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    port = int(os.environ.get('PORT', 8555))
    print(f"[MT5 Bridge] HTTP Server running on http://127.0.0.1:{port}")
    try:
        from waitress import serve
        serve(app, host='0.0.0.0', port=port)
    except ImportError:
        app.run(host='0.0.0.0', port=port)

