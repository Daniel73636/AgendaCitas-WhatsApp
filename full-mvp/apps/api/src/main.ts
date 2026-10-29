import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { loadConfig } from './common/config';

async function bootstrap() {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  const log = new Logger('Bootstrap');
  log.log(`API lista en http://localhost:${config.port}  (salud: /v1/health)`);
  log.log(`Publico: GET /v1/public/belleza-demo | Panel: POST /v1/auth/login (admin@belleza-demo.com / demo1234)`);
  log.log(`OTP: ${config.otpMode === 'mock' ? `MOCK (codigo ${config.otpMockCode})` : 'real'} | WhatsApp: ${config.whatsappMode}`);
}

bootstrap().catch((err) => {
  console.error('No se pudo iniciar la API:', err);
  process.exit(1);
});
