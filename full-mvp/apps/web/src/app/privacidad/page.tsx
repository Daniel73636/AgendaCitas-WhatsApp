import type { Metadata } from 'next';
import { PrivacyPolicy } from '@/components/privacy-policy';

export const metadata: Metadata = { title: 'Política de privacidad' };

export default function PrivacyPage() {
  return <PrivacyPolicy backHref="/" />;
}
