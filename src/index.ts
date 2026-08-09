import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';
import { schedulerEngine } from './scheduler/engine.js';
import { ensureDockerBridgeRunning } from './xm360/dockerBridgeManager.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8444;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-BX-APIKEY'],
}));
app.use(express.json());

// API routes (support /api, /xm-api, and root routes)
app.use('/api', apiRouter);
app.use('/xm-api', apiRouter);
app.use('/', apiRouter);

// Health check
app.get('/health', (req, res) => {
  const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  res.json({ status: 'ok', timeIST: istTime, timestamp: Date.now() });
});

// Start engine & server
async function startServer() {
  await schedulerEngine.init();

  // Automatically ensure MT5 Docker Container is running on app boot/restart
  await ensureDockerBridgeRunning();

  const host = '0.0.0.0';
  app.listen(Number(PORT), host, () => {
    console.log(`⚡ High-Precision XM360 Order Scheduler Server running on http://${host}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
});
