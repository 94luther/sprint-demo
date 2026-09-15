// Load .env before anything else is required, so every module that reads
// process.env at import time (the tracking gateway's CORS origin, the aes
// helper's key, JWT secret) sees the real values. A plain require() runs
// exactly where it is written; an `import` above it would not.
require('dotenv').config();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });

  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  app.enableCors({
    origin: webOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true,
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  const httpAdapter = app.getHttpAdapter().getInstance();
  if (typeof httpAdapter.disable === 'function') {
    httpAdapter.disable('x-powered-by');
  }

  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Sprint alpha API is up on http://localhost:${port}, socket namespace /rt, web origin ${webOrigin}.`);
}

bootstrap();
