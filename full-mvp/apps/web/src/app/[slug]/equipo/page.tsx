import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/booking/booking-wizard';
import { getBusiness } from '@/lib/public';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await getBusiness(slug);
  if (!b) notFound();
  return (
    <main className="mx-auto max-w-2xl pb-28">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur">
        <Link href={`/${slug}`} aria-label="Volver" className="rounded-full p-2 hover:bg-muted"><ArrowLeft size={20} /></Link>
        <h1 className="text-lg font-semibold">Equipo de {b.tenant.name}</h1>
      </header>
      <ul className="flex flex-col gap-3 p-4">
        {b.staff.map((s) => (
          <li key={s.id} className="flex gap-4 rounded-2xl border border-border bg-card p-4">
            <Avatar name={s.displayName} color={s.color} photoUrl={s.photoUrl} size={72} />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{s.displayName}</h2>
              {s.bio && <p className="text-sm text-muted-foreground">{s.bio}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.specialties.map((sp) => <span key={sp} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{sp}</span>)}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Realiza: {b.services.filter((sv) => s.serviceIds.includes(sv.id)).map((sv) => sv.name).join(', ')}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-2xl px-4 pt-3">
          <Link href={`/${slug}/reservar`} className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground">Reservar cita</Link>
        </div>
      </div>
    </main>
  );
}
