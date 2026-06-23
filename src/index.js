const express = require('express');
const { Pool } = require('pg');

const requiredEnvironmentVariables = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name],
);

if (missingEnvironmentVariables.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvironmentVariables.join(', ')}`,
  );
  process.exit(1);
}

const port = Number.parseInt(process.env.PORT || '3000', 10);
if (Number.isNaN(port)) {
  console.error('PORT must be a valid number');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

const app = express();
app.disable('x-powered-by');

app.get('/health', (_request, response) => {
  response.json({
    status: 'UP',
    service: 'nagp-product-api',
  });
});

app.get('/products', async (_request, response, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category, price FROM products ORDER BY id',
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.use((request, response) => {
  response.status(404).json({
    error: 'Not Found',
    path: request.path,
  });
});

app.use((error, _request, response, _next) => {
  console.error('Request failed', error);
  response.status(500).json({
    error: 'Internal Server Error',
    message: 'Unable to complete the request',
  });
});

const server = app.listen(port, () => {
  console.log(`nagp-product-api listening on port ${port}`);
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received; starting graceful shutdown`);

  server.close(async (serverError) => {
    try {
      await pool.end();
      if (serverError) {
        throw serverError;
      }
      console.log('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Graceful shutdown failed', error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
