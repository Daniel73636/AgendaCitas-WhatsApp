'use client';
import type { PublicAppointmentDto } from '@agenda/contracts';
import { buildIcs, googleCalendarUrl } from '@agenda/domain-booking';
import { Badge, Button, Card, cn } from '@agenda/ui';
import { CalendarPlus, Clock, MapPin, Share2, UserRound } from 'lucide-react';
import { STATUS_META, durationLabel, fmtDateLong, fmtTime, money } from '@/lib/format';
import { toast } from '@/lib/session';

export function calendarEvent(a: PublicAppointmentDto) {
  return {
    uid: a.id,
    title: `${a.services.map((s) => s.name).join(' + ')} · ${a.business.name}`,
    description: `Cita con ${a.staffName}. Total: ${money(a.totalCents, a.currency)}.`,
    location: a.business.address ?? a.business.name,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
  };
}

export function downloadIcs(a: PublicAppointmentDto) {
  const blob = new Blob([buildIcs(calendarEvent(a))], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cita.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareLocation(a: PublicAppointmentDto) {
  const text = `${a.business.name}${a.business.address ? ` · ${a.business.address}` : ''}`;
  const url = a.mapsUrl ?? undefined;
  try {
    if (navigator.share) await navigator.share({ title: a.business.name, text, ...(url ? { url } : {}) });
    else {
      await navigator.clipboard.writeText(`${text}${url ? ` ${url}` : ''}`);
      toast.success('Ubicacion copiada al portapapeles');
    }
  } catch {
    /* cancelado */
  }
}

/** Resumen de la cita + acciones: calendario, como llegar, compartir ubicacion. */
export function AppointmentSummary({ apt, compact }: { apt: PublicAppointmentDto; compact?: boolean }) {
  const meta = STATUS_META[apt.status];
  const tz = apt.business.timezone;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 bg-secondary px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-secondary-foreground/70">{apt.business.name}</p>
          <p className="text-lg font-semibold first-letter:uppercase">{fmtDateLong(apt.startsAt, tz)}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock size={14} /> {fmtTime(apt.startsAt, tz)} – {fmtTime(apt.endsAt, tz)}
          </p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 text-sm">
        <ul className="flex flex-col gap-1.5">
          {apt.services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span>{s.name} <span className="text-muted-foreground">· {durationLabel(s.durationMin)}</span></span>
              <span className="tabular-nums">{money(s.priceCents, apt.currency)}</span>
            </li>
          ))}
          <li className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(apt.totalCents, apt.currency)}</span>
          </li>
          {apt.depositRequiredCents > 0 && (
            <li className="flex items-center justify-between text-muted-foreground">
              <span>Anticipo {apt.depositPaidCents >= apt.depositRequiredCents ? 'pagado' : 'requerido'}</span>
              <span className="tabular-nums">{money(apt.depositRequiredCents, apt.currency)}</span>
            </li>
          )}
        </ul>
        <p className="flex items-center gap-2 text-muted-foreground"><UserRound size={15} /> Te atiende {apt.staffName}</p>
        {apt.business.address && <p className="flex items-start gap-2 text-muted-foreground"><MapPin size={15} className="mt-0.5 shrink-0" /> {apt.business.address}</p>}
      </div>
      {!compact && (
        <div className={cn('grid gap-2 border-t border-border p-4 sm:grid-cols-3')}>
          <Button variant="outline" size="sm" onClick={() => downloadIcs(apt)}><CalendarPlus size={15} /> Agregar al calendario</Button>
          {apt.mapsUrl && (
            <a href={apt.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-medium hover:bg-muted">
              <MapPin size={15} /> Como llegar
            </a>
          )}
          <Button variant="outline" size="sm" onClick={() => shareLocation(apt)}><Share2 size={15} /> Compartir ubicacion</Button>
          <a href={googleCalendarUrl(calendarEvent(apt))} target="_blank" rel="noreferrer" className="text-center text-xs text-primary underline-offset-4 hover:underline sm:col-span-3">
            O abrir en Google Calendar
          </a>
        </div>
      )}
    </Card>
  );
}
