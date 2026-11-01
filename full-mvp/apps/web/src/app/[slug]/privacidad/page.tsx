import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrivacyPolicy } from '@/components/privacy-policy';
import { getBusiness } from '@/lib/public';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Política de privacidad' };

export default async function BusinessPrivacyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await getBusiness(slug);
  if (!b) notFound();
  return <PrivacyPolicy backHref={`/${slug}`} responsible={{ name: b.tenant.name, phone: b.tenant.phone, address: b.tenant.address }} />;
}
