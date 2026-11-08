import type { Metadata } from 'next';
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

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
