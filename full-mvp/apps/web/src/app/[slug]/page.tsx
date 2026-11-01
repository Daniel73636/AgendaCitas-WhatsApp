import { Clock, MapPin, MessageCircle, Phone } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@agenda/ui';
import { Avatar } from '@/components/booking/booking-wizard';
import { InstallPrompt } from '@/components/pwa';
import { durationLabel, money, waLink } from '@/lib/format';
import { getBusiness } from '@/lib/public';

export const dynamic = 'force-dynamic';

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await getBusiness(slug);
  if (!b) notFound();
  const { tenant } = b;
  const groups = new Map<string, typeof b.services>();
  for (const s of b.services) (groups.get(s.category ?? 'Servicios') ?? groups.set(s.category ?? 'Servicios', []).get(s.category ?? 'Servicios')!).push(s);
  const mapUrl = tenant.lat != null && tenant.lng != null ? `https://www.google.com/maps/search/?api=1&query=${tenant.lat},${tenant.lng}` : tenant.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tenant.address)}` : null;

  return (
    <main className="mx-auto max-w-2xl pb-28">
      <section className="relative overflow-hidden bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-500 px-5 pb-8 pt-12 text-white safe-top">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-3xl backdrop-blur">{tenant.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={tenant.logoUrl} alt="" className="h-full w-full rounded-2xl object-cover" /> : '💇'}</div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{tenant.name}</h1>
            <p className="text-sm text-white/85">Reserva en linea · confirmacion por WhatsApp</p>
          </div>
        </div>
        {tenant.description && <p className="relative mt-4 text-sm leading-relaxed text-white/90">{tenant.description}</p>}
        <div className="relative mt-4 flex flex-wrap gap-2 text-xs">
          {tenant.address && mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 backdrop-blur hover:bg-white/30"><MapPin size={13} /> {tenant.address}</a>
          )}
          {tenant.phone && (
            <a href={waLink(tenant.phone, 'Hola, quisiera consultar por una cita')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 backdrop-blur hover:bg-white/30"><MessageCircle size={13} /> Escribir por WhatsApp</a>
          )}
          {tenant.phone && <a href={`tel:${tenant.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 backdrop-blur hover:bg-white/30"><Phone size={13} /> Llamar</a>}
        </div>
      </section>

      <div className="flex flex-col gap-8 px-4 pt-6">
        <InstallPrompt />
        <section aria-labelledby="servicios">
          <h2 id="servicios" className="mb-3 text-xl font-bold">Servicios</h2>
          <div className="flex flex-col gap-6">
            {[...groups.entries()].map(([cat, list]) => (
              <div key={cat}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h3>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                  {list.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 p-4">
                      <div>
                        <p className="font-semibold">{s.name}</p>
                        {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Clock size={12} /> {durationLabel(s.durationMin)}</span>
                          {s.depositCents > 0 && <Badge tone="warning">Anticipo {money(s.depositCents, tenant.currency)}</Badge>}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">{money(s.priceCents, tenant.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="equipo">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="equipo" className="text-xl font-bold">Nuestro equipo</h2>
            <Link href={`/${slug}/equipo`} className="text-sm font-medium text-primary">Ver todos</Link>
          </div>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {b.staff.map((s) => (
              <div key={s.id} className="flex w-32 shrink-0 flex-col items-center gap-2 rounded-2xl border border-border bg-card p-3 text-center">
                <Avatar name={s.displayName} color={s.color} photoUrl={s.photoUrl} size={64} />
                <p className="text-sm font-semibold leading-tight">{s.displayName}</p>
                <p className="line-clamp-2 text-[11px] text-muted-foreground">{s.specialties.join(' · ')}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Politica de cancelacion</p>
          <p>Puedes cancelar o reprogramar gratis hasta {b.settings.cancelMinHours} horas antes desde el enlace que recibes por WhatsApp.</p>
        </section>
      </div>

      <p className="px-4 pb-4 pt-2 text-center text-xs text-muted-foreground">
        <Link href={`/${slug}/privacidad`} className="underline underline-offset-2">Política de privacidad</Link>
      </p>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-2xl px-4 pt-3">
          <Link href={`/${slug}/reservar`} className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90 active:scale-[0.99]">
            Reservar cita
          </Link>
        </div>
      </div>
    </main>
  );
}
