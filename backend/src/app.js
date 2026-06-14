import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import mongoose from 'mongoose';

import config from './config/index.js';
import apiRoutes from './routes/index.js';
import { errorHandler } from './middlewares/error.js';
import { generalLimiter } from './middlewares/rateLimiter.js';
import { correlationId } from './middlewares/correlationId.js';
import { ApiResponse } from './utils/apiResponse.js';
import logger from './utils/logger.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './docs/swagger.js';

// Import the shared Redis singleton (created once in queue.js)
import { redisConnection } from './queues/queue.js';

const app = express();

// ── 1. Correlation ID (must be first) ────────────────────────────────
app.use(correlationId);

// ── 2. Security headers ───────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding visualizations
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://api.dicebear.com', 'https://res.cloudinary.com'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"]
    }
  }
}));

// Clickjacking protection
app.use(helmet.frameguard({ action: 'deny' }));

// ── 3. CORS ───────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Parse clientUrl as a comma-separated list of allowed origins
    const allowedOrigins = config.clientUrl
      ? config.clientUrl.split(',').map(o => o.trim())
      : [];
      
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Allow localhost/127.0.0.1 in development environment
    if (config.env === 'development') {
      try {
        const url = new URL(origin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          return callback(null, true);
        }
      } catch (err) {
        // Ignore invalid URL format
      }
    }
    
    callback(new Error(`CORS: Origin '${origin}' is not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  optionsSuccessStatus: 200
}));

// ── 4. Request parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser(config.cookieSecret));

// ── 5. NoSQL injection sanitization ──────────────────────────────────
app.use(mongoSanitize({
  replaceWith: '_', // Replace $ and . with _ instead of stripping
  onSanitize: ({ req, key }) => {
    logger.warn('Sanitized NoSQL injection attempt', {
      path: req.path,
      key,
      ip: req.ip,
      correlationId: req.correlationId
    });
  }
}));

// ── 6. NOTE: xss-clean removed (unmaintained, MED-09 fix) ────────────
// XSS prevention is handled by:
//   - helmet CSP headers (output encoding)
//   - Zod validation transforming all inputs
//   - mongoose schema validation

// ── 7. Compression ────────────────────────────────────────────────────
app.use(compression());

// ── 8. Request logging middleware ─────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[logLevel](`${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      correlationId: req.correlationId,
      userId: req.user?._id?.toString()
    });
  });
  next();
});

// ── 9. General rate limiting ──────────────────────────────────────────
app.use('/api', generalLimiter);

// ── 10. Home Route ────────────────────────────────────────────────────
app.get('/', (req, res) => {
  return res.status(200).json(
    new ApiResponse(200, {
      name: 'DSA Algorithm Analyzer & Visualizer API',
      status: 'online',
      version: process.env.npm_package_version || '1.0.0',
      docs: '/api-docs',
      health: '/health'
    }, 'Welcome to the DSA Visualizer API!')
  );
});

// ── 11. Health Check ──────────────────────────────────────────────────
// Uses the shared Redis connection — does NOT create a new connection per request (CRIT-05 fix)
app.get('/health', async (req, res) => {
  const health = {
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    env: config.env,
    version: process.env.npm_package_version || '1.0.0',
    database: 'disconnected',
    redis: 'disconnected'
  };

  // Check MongoDB
  if (mongoose.connection.readyState === 1) {
    health.database = 'connected';
  }

  // Check Redis using the shared singleton connection
  try {
    if (redisConnection && redisConnection.status === 'ready') {
      const ping = await redisConnection.ping();
      health.redis = ping === 'PONG' ? 'connected' : 'degraded';
    }
  } catch {
    health.redis = 'error';
  }

  const isHealthy =
    health.database === 'connected' &&
    (config.env === 'test' || health.redis === 'connected');

  return res.status(isHealthy ? 200 : 503).json(
    new ApiResponse(isHealthy ? 200 : 503, health, isHealthy ? 'Healthy' : 'Degraded')
  );
});

// ── 11. Swagger / API Documentation ──────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ── 12. API Routes ────────────────────────────────────────────────────
app.use('/api/v1', apiRoutes);

// ── 13. 404 Handler ───────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json(
    new ApiResponse(404, null, `Route ${req.method} ${req.originalUrl} not found`)
  );
});

// ── 14. Centralized error handler (must be last) ──────────────────────
app.use(errorHandler);

export default app;
