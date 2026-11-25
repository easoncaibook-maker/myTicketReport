import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });

  const webDistDir = process.env.WEB_DIST_DIR;
  if (webDistDir && existsSync(join(webDistDir, 'index.html'))) {
    app.useStaticAssets(webDistDir, { index: false });
    // SPA 回退：非 /api 的 GET 请求且不是静态资源时返回 index.html
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api')) return next();
      if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();
      res.sendFile(join(webDistDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  if (process.env.HOST) {
    await app.listen(port, process.env.HOST);
  } else {
    await app.listen(port);
  }
  // eslint-disable-next-line no-console
  console.log(`[TicketReport] listening on http://localhost:${port}/`);
}

bootstrap();
