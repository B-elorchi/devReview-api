module.exports = {
  apps: [
    {
      name: "devreview-api",
      script: "npm",
      args: "run start",
      cwd: "./",
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
      script: "npm",
      args: "run worker",
      cwd: "./",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
