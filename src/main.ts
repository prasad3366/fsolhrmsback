import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { buildCorsOptions } from './cors-options';

process.env.TZ = 'Asia/Kolkata';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const corsOptions = buildCorsOptions();
  app.enableCors(corsOptions);
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Add `/api` global prefix so frontend can call `/api/auth/login`
  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(3000);
  console.log(`🚀 Server is running on http://localhost:3000`);
  console.log('🔗 Frontend origins allowed: localhost / 127.0.0.1 dev ports');
}
bootstrap();
