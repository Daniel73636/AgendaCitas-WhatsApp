import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/hoy',
    name: 'Agenda de citas con WhatsApp',
    short_name: 'Agenda',
    description: 'Panel de agenda: citas del dia, calendario, clientes y mensajes de WhatsApp.',
    lang: 'es',
    start_url: '/hoy',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#faf8ff',
    theme_color: '#7c3aed',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Citas de hoy', url: '/hoy', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Calendario', url: '/calendario', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Mensajes', url: '/mensajes', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
