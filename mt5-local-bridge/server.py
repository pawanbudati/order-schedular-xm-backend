import os
import sys
from flask import Flask, request, jsonify

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

app = Flask(__name__)

def load_env_vars():
    env_paths = [
        os.path.join(os.path.dirname(__file__), '.env'),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'),
    ]
    for p in env_paths:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            k, v = line.split('=', 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if k not in os.environ:
                                os.environ[k] = v
            except Exception:
                pass

load_env_vars()

def get_configured_terminal_paths():
    paths = []
    # 1. Comma-separated list (unlimited)
    env_list = os.environ.get('MT5_TERMINAL_PATHS', '')
    if env_list:
        for item in env_list.split(','):
            item = item.strip().strip('"').strip("'")
            if item and item not in paths:
                paths.append(item)
    
    # 2. Single MT5_PATH fallback
    if os.environ.get('MT5_PATH') and os.environ.get('MT5_PATH') not in paths:
        paths.append(os.environ.get('MT5_PATH').strip())
        
    # 3. Dynamic MT5_PATH_1..MT5_PATH_100 and any MT5_PATH_* variables
    for key, val in os.environ.items():
        if key.startswith('MT5_PATH_') and val:
            p = val.strip().strip('"').strip("'")
            if p and p not in paths:
                paths.append(p)
                
    return paths

def resolve_account_context(account_id=None, path=None, server=None, password=None):
    if not mt5:
        return False, "MetaTrader5 module not installed"
    
    acc_id_str = str(account_id).strip() if account_id is not None and str(account_id).strip() != "" else None
    path_str = str(path).strip() if path is not None and str(path).strip() != "" else None
    server_str = str(server).strip() if server is not None and str(server).strip() != "" else None
    password_str = str(password).strip() if password is not None and str(password).strip() != "" else None

    # If path not explicitly provided, search configured paths from .env for matching account
    if not path_str and acc_id_str:
        configured_paths = get_configured_terminal_paths()
        for c_path in configured_paths:
            if os.path.exists(c_path):
                mt5.shutdown()
                if mt5.initialize(path=c_path):
                    acc = mt5.account_info()
                    if acc and str(acc.login) == acc_id_str:
                        return True, f"Attached to account {acc.login} on terminal path {c_path}"

    curr_acc = mt5.account_info()
    if curr_acc and acc_id_str and str(curr_acc.login) == acc_id_str:
        return True, f"Already connected to target account {curr_acc.login}"

    init_kwargs = {}
    if path_str and os.path.exists(path_str):
        init_kwargs['path'] = path_str
    if acc_id_str and acc_id_str.isdigit():
        init_kwargs['login'] = int(acc_id_str)
    if password_str:
        init_kwargs['password'] = password_str
    if server_str:
        init_kwargs['server'] = server_str

    if init_kwargs:
        mt5.shutdown()
        if mt5.initialize(**init_kwargs):
            acc = mt5.account_info()
            if acc and (not acc_id_str or str(acc.login) == acc_id_str):
                return True, f"Connected to account {acc.login}"
            if acc_id_str and acc_id_str.isdigit() and password_str:
                if mt5.login(login=int(acc_id_str), password=password_str, server=server_str or ""):
                    return True, f"Logged into account {acc_id_str}"
        mt5.initialize()
    else:
        if not mt5.terminal_info():
            mt5.initialize()

    curr_acc = mt5.account_info()
    if curr_acc:
        if acc_id_str and str(curr_acc.login) != acc_id_str and acc_id_str.isdigit():
            if mt5.login(login=int(acc_id_str), password=password_str or "", server=server_str or ""):
                return True, f"Logged into account {acc_id_str}"
        return True, f"Connected to active account {curr_acc.login}"

    return False, f"Failed to attach to MT5 account {acc_id_str or 'default'}: {mt5.last_error()}"

def is_tradable(info):
    if not info:
        return False
    if hasattr(info, 'trade_mode') and info.trade_mode == mt5.SYMBOL_TRADE_MODE_DISABLED:
        return False
    return True

def resolve_mt5_symbol(requested_symbol: str):
    if not mt5 or not requested_symbol:
        return requested_symbol, None
        
    raw = requested_symbol.strip()
    
    mt5.symbol_select(raw, True)
    info = mt5.symbol_info(raw)
    if info and is_tradable(info):
        return raw, info

    for name in [raw.upper(), raw.lower()]:
        mt5.symbol_select(name, True)
        info = mt5.symbol_info(name)
        if info and is_tradable(info):
            return name, info

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
    if not mt5.terminal_info():
        mt5.initialize()
    init_ok = mt5.terminal_info() is not None
    return jsonify({"status": "ok", "mt5_connected": init_ok})

@app.route('/instances', methods=['GET'])
def instances():
    if not mt5:
        return jsonify({"success": False, "instances": [], "error": "MT5 module not installed"}), 500
    
    paths = get_configured_terminal_paths()
    found_instances = []
    
    active_acc = mt5.account_info()
    if active_acc:
        found_instances.append({
            "account_id": str(active_acc.login),
            "server": active_acc.server,
            "balance": active_acc.balance,
            "equity": active_acc.equity,
            "currency": active_acc.currency,
            "leverage": active_acc.leverage,
            "path": ""
        })

    for p in paths:
        if os.path.exists(p):
            mt5.shutdown()
            if mt5.initialize(path=p):
                acc = mt5.account_info()
                if acc:
                    acc_id = str(acc.login)
                    if not any(i["account_id"] == acc_id for i in found_instances):
                        found_instances.append({
                            "account_id": acc_id,
                            "server": acc.server,
                            "balance": acc.balance,
                            "equity": acc.equity,
                            "currency": acc.currency,
                            "leverage": acc.leverage,
                            "path": p
                        })

    if found_instances and not mt5.terminal_info():
        first_p = found_instances[0].get("path")
        if first_p:
            mt5.initialize(path=first_p)
        else:
            mt5.initialize()

    return jsonify({"success": True, "instances": found_instances, "configured_paths": paths})

@app.route('/connect', methods=['POST', 'GET'])
def connect():
    if not mt5:
        return jsonify({"success": False, "error": "MetaTrader5 module is not installed on this machine."}), 500

    data = request.json if request.is_json else request.args
    account_id = data.get('accountId') or data.get('account_id')
    path = data.get('path')
    server = data.get('server')
    password = data.get('password')

    ok, msg = resolve_account_context(account_id=account_id, path=path, server=server, password=password)
    acc_info = mt5.account_info()
    if ok and acc_info:
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
            "error": f"Failed to attach to MT5 terminal: {msg}"
        }), 400

@app.route('/switch', methods=['POST'])
def switch_account():
    if not mt5:
        return jsonify({"success": False, "error": "MetaTrader5 module not installed"}), 500

    data = request.json or {}
    account_id = data.get('accountId') or data.get('account_id')
    path = data.get('path')
    server = data.get('server')
    password = data.get('password')

    ok, msg = resolve_account_context(account_id=account_id, path=path, server=server, password=password)
    acc_info = mt5.account_info()
    if ok and acc_info:
        return jsonify({
            "success": True,
            "message": msg,
            "account_id": str(acc_info.login),
            "server": acc_info.server,
            "balance": acc_info.balance,
            "equity": acc_info.equity,
            "currency": acc_info.currency
        })
    return jsonify({"success": False, "error": msg}), 400

@app.route('/account', methods=['GET'])
def account():
    if not mt5:
        return jsonify({"error": "MetaTrader5 module not installed"}), 500

    account_id = request.args.get('accountId') or request.args.get('account_id')
    path = request.args.get('path')
    server = request.args.get('server')
    password = request.args.get('password')

    resolve_account_context(account_id=account_id, path=path, server=server, password=password)

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
    
    account_id = request.args.get('accountId') or request.args.get('account_id')
    path = request.args.get('path')
    server = request.args.get('server')
    password = request.args.get('password')

    resolve_account_context(account_id=account_id, path=path, server=server, password=password)

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

    data = request.json or {}
    account_id = data.get('accountId') or data.get('account_id')
    path = data.get('path')
    server = data.get('server')
    password = data.get('password')

    ok, msg = resolve_account_context(account_id=account_id, path=path, server=server, password=password)
    if not ok:
        print(f"[WARNING] Account resolution note before trade execution: {msg}")

    raw_symbol = str(data.get('symbol', 'XAUUSD')).strip()
    action = str(data.get('action', 'BUY')).upper()
    volume = float(data.get('volume', 0.01))
    price = data.get('price')
    stop_loss = data.get('stopLoss')
    take_profit = data.get('takeProfit')

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

    filling_modes = []
    if hasattr(symbol_info, 'filling_mode') and symbol_info.filling_mode:
        fm = symbol_info.filling_mode
        if fm & mt5.ORDER_FILLING_FOK:
            filling_modes.append(mt5.ORDER_FILLING_FOK)
        if fm & mt5.ORDER_FILLING_IOC:
            filling_modes.append(mt5.ORDER_FILLING_IOC)
        if fm & mt5.ORDER_FILLING_RETURN:
            filling_modes.append(mt5.ORDER_FILLING_RETURN)

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
        if not mt5.terminal_info():
            mt5.initialize()
    except ImportError:
        app.run(host='0.0.0.0', port=port)

