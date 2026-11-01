import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isProd = process.env.NODE_ENV === 'production';

/** Origen de la API para `connect-src` (la web llama a la API desde el navegador). */
function apiOrigin() {
  const fixed = process.env.NEXT_PUBLIC_API_URL;
  if (fixed) {
    try {
      return new URL(fixed).origin;
    } catch {
      /* se ignora: URL invalida */
    }
  }
  const port = process.env.NEXT_PUBLIC_API_PORT ?? '4100';
  // Sin URL fija el cliente usa el mismo host de la web con el puerto de la API
  return isProd ? `https://*:${port} http://*:${port}` : 'http: https: ws: wss:';
}

// Next.js necesita 'unsafe-inline' para sus scripts de hidratacion; 'unsafe-eval' solo en desarrollo (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin()}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: root,
  transpilePackages: ['@agenda/ui', '@agenda/domain-booking', '@agenda/contracts'],
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // El service worker nunca debe quedar cacheado por el navegador
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
export default nextConfig;
