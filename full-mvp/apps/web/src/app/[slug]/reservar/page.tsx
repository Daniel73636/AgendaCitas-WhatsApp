import { BookingWizard } from '@/components/booking/booking-wizard';

export const metadata = { title: 'Reservar cita' };

export default async function ReservarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BookingWizard slug={slug} />;
}
