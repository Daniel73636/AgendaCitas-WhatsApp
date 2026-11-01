import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { ConfigError, isMockOtp, loadConfig } from './common/config';

async function bootstrap() {
  const config = loadConfig();
  const log = new Logger('Bootstrap');
  for (const w of config.warnings) log.warn(w);
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  log.log(`API lista en http://localhost:${config.port}  (salud: /health, listo: /ready) [${config.nodeEnv}${config.demoMode ? ', DEMO_MODE' : ''}]`);
  if (config.demoMode) {
    log.warn('DEMO_MODE activo: OTP de demostracion, cuenta demo y pago simulado habilitados. No usar en produccion.');
    log.log('Publico: GET /v1/public/belleza-demo | Panel: POST /v1/auth/login (admin@belleza-demo.com / demo1234)');
  }
  log.log(`OTP: ${isMockOtp(config) ? `DEMO (codigo ${config.otpMockCode})` : 'real'} | WhatsApp: ${config.whatsappMode}`);
}

bootstrap().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`\nNo se pudo iniciar la API.\n${err.message}\n\nRevisa tu .env (ver .env.example).`);
  } else {
    console.error('No se pudo iniciar la API:', err);
  }
  process.exit(1);
});
