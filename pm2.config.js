module.exports = {
  apps: [
    {
      name: 'order-schedular-xm-backend',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 8444,
      },
    },
    {
      name: 'mt5-local-bridge',
      script: 'mt5-local-bridge/server.py',
      interpreter: 'python',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        PORT: 8555,
      },
    },
    {
      name: 'cloudflare-tunnel',
      script: 'cloudflared',
      args: 'tunnel --url http://127.0.0.1:8444',
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
