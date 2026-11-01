import type { Metadata } from 'next';
import { brandHsl, normalizeBrand } from '@/lib/brand';
import { getBusiness } from '@/lib/public';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBusiness(slug).catch(() => null);
  return {
    title: b ? b.tenant.name : 'Reservar cita',
    description: b?.tenant.description ?? undefined,
    manifest: `/${slug}/manifest.webmanifest`,
  };
}

export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await getBusiness(slug).catch(() => null);
  const brand = normalizeBrand(b?.tenant.brandColor);
  const hsl = brandHsl(brand);
  return <div style={{ ['--primary' as string]: hsl, ['--ring' as string]: hsl }}>{children}</div>;
}
