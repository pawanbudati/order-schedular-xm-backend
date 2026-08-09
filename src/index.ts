import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';
import { schedulerEngine } from './scheduler/engine.js';

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
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start engine & server
async function startServer() {
  await schedulerEngine.init();

  const host = '0.0.0.0';
  app.listen(Number(PORT), host, () => {
    console.log(`⚡ High-Precision XM360 Order Scheduler Server running on http://${host}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
});
