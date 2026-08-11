const fs = require('fs');
const { execSync } = require('child_process');

// Dynamically detect Python interpreter on Windows ('python', 'py', or full executable path)
function getPythonInterpreter() {
  if (process.env.PYTHON_EXECUTABLE && fs.existsSync(process.env.PYTHON_EXECUTABLE)) {
    return process.env.PYTHON_EXECUTABLE;
  }

  try {
    const wherePython = execSync('where python', { encoding: 'utf-8' }).trim().split('\r\n')[0];
    if (wherePython && fs.existsSync(wherePython)) {
      return wherePython;
    }
  } catch (e) {}

  try {
    const wherePy = execSync('where py', { encoding: 'utf-8' }).trim().split('\r\n')[0];
    if (wherePy && fs.existsSync(wherePy)) {
      return wherePy;
    }
  } catch (e) {}

  return 'python';
}

const apps = [
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
    interpreter: getPythonInterpreter(),
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      PORT: 8555,
      PYTHONIOENCODING: 'utf-8',
    },
  },
];

// Include caddy-ssl only if Caddyfile exists (e.g. AWS production VM)
if (fs.existsSync('C:\\apps\\Caddyfile')) {
  apps.push({
    name: 'caddy-ssl',
    script: 'caddy',
    args: 'run --config C:\\apps\\Caddyfile',
    instances: 1,
    autorestart: true,
    watch: false,
  });
}

module.exports = { apps };
