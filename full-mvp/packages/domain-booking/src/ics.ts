const fmt = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
}

/** Genera un archivo iCalendar (.ics) para "Agregar al calendario". */
export function buildIcs(ev: IcsEvent, nowIso = new Date().toISOString()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agenda Citas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@agenda-citas`,
    `DTSTAMP:${fmt(nowIso)}`,
    `DTSTART:${fmt(ev.startsAt)}`,
    `DTEND:${fmt(ev.endsAt)}`,
    `SUMMARY:${esc(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${esc(ev.description)}`] : []),
    ...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio de cita',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export function googleCalendarUrl(ev: IcsEvent): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${fmt(ev.startsAt)}/${fmt(ev.endsAt)}`,
    details: ev.description ?? '',
    location: ev.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
