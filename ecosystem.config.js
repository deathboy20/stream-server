module.exports = {
  apps: [
    {
      name: 'teleconference-server',
      cwd: __dirname,
      script: './dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--enable-source-maps',
      env_file: '.env',
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_restarts: 15,
      exp_backoff_restart_delay: 100,
      min_uptime: '15s',
      max_memory_restart: '512M',
      kill_timeout: 30000,
      listen_timeout: 10000,
      autorestart: true,
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git'],
      env: {
        NODE_ENV: 'development',
        PORT: 5002,
        CORS_CREDENTIALS: 'false'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3002,
        CORS_CREDENTIALS: 'false'
      }
    }
  ],
};
