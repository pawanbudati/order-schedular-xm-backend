//+------------------------------------------------------------------+
//|                                        XM360_Local_Bridge.mq5    |
//|               XM360 High-Precision Order Execution EA for Linux  |
//|                   Compatible with Linux (Wine), Windows & macOS  |
//+------------------------------------------------------------------+
#property copyright "XM360 Order Scheduler"
#property link      "https://neo-copier.duckdns.org"
#property version   "1.00"
#property strict

// Inputs
input string   InpBackendUrl = "http://localhost:8444/api/orders"; // Backend Orders API URL
input int      InpPollIntervalMs = 100;                           // Poll interval in ms

// Global Variables
ulong lastExecutedTime = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   EventSetMillisecondTimer(InpPollIntervalMs);
   Print("🚀 XM360 Local EA Execution Bridge Initialized on Linux/Wine!");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Print("🛑 XM360 Local EA Stopped.");
  }

//+------------------------------------------------------------------+
//| Timer function for high-frequency polling                        |
//+------------------------------------------------------------------+
void OnTimer()
  {
   // Allow WebRequest to backend URL
   string cookie=NULL, headers;
   char post[], result[];
   string result_headers;
   int timeout = 500;

   int res = WebRequest("GET", InpBackendUrl, NULL, timeout, post, result, result_headers);
   if(res == 200)
     {
      string responseText = CharArrayToString(result);
      // Process pending orders sent from Node.js backend
     }
  }

//+------------------------------------------------------------------+
//| Helper Function to Place XM Trade                                |
//+------------------------------------------------------------------+
bool ExecuteXMTrade(string symbol, string action, double volume, double sl, double tp)
  {
   MqlTradeRequest request={0};
   MqlTradeResult  result={0};

   request.action   = TRADE_ACTION_DEAL;
   request.symbol   = symbol;
   request.volume   = volume;
   request.type     = (action == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price    = (action == "BUY") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   request.sl       = sl;
   request.tp       = tp;
   request.deviation= 10;
   request.magic    = 202608;
   request.comment  = "XM360 Linux Scheduler";

   return OrderSend(request, result);
  }
