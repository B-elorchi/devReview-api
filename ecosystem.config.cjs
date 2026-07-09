module.exports = {
  apps: [
    {
      name: "devreview-api",
      script: "dist/server.js",
      cwd: "./",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "devreview-worker",
      script: "./node_modules/tsx/dist/cli.mjs",
      args: "src/workers/index.ts",
      cwd: "./",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
