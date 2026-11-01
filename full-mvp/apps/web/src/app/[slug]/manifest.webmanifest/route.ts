import { normalizeBrand } from '@/lib/brand';
import { getBusiness } from '@/lib/public';

/** Manifiesto por negocio: el cliente final puede instalar la pagina de reservas como app. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await getBusiness(slug).catch(() => null);
  const name = b?.tenant.name ?? 'Reservas';
  return Response.json(
    {
      id: `/${slug}`,
      name: `${name} · Reservas`,
      short_name: name.slice(0, 12),
      lang: 'es',
      start_url: `/${slug}`,
      scope: `/${slug}`,
      display: 'standalone',
      background_color: '#faf8ff',
      theme_color: normalizeBrand(b?.tenant.brandColor),
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
