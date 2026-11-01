/**
 * Plantillas de WhatsApp (categoria utilidad + marketing). Texto en espanol.
 * En modo cloud se envian como plantillas aprobadas por Meta (nombre + parametros);
 * en modo mock se renderiza el texto para verlo en consola, bandeja y message_log.
 */
export const TEMPLATE_NAMES = [
  'appointment_confirmation',
  'appointment_reminder_24h',
  'appointment_reminder_6h',
  'appointment_reminder_2h',
  'appointment_rescheduled',
  'appointment_canceled',
  'waitlist_offer',
  'review_request',
  'otp_code',
  'birthday_offer',
  'winback',
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export interface TemplateParams {
  name?: string;
  business?: string;
  service?: string;
  staff?: string;
  date?: string;
  time?: string;
  address?: string;
  link?: string;
  code?: string;
  deposit?: string;
  offerMinutes?: string;
  reviewUrl?: string;
  [k: string]: string | undefined;
}

export interface TemplateButton {
  id: 'confirm' | 'reschedule' | 'cancel' | 'accept';
  label: string;
}

interface TemplateDef {
  category: 'utility' | 'marketing' | 'authentication';
  /** Parametros en el orden en que se envian a la API (variables {{1}}..{{n}}). */
  params: Array<keyof TemplateParams>;
  body: string;
  buttons?: TemplateButton[];
}

export const TEMPLATES: Record<TemplateName, TemplateDef> = {
  appointment_confirmation: {
    category: 'utility',
    params: ['name', 'service', 'date', 'time', 'staff', 'business', 'link'],
    body: 'Hola {{name}}, tu cita de *{{service}}* en {{business}} quedó confirmada para el {{date}} a las {{time}} con {{staff}}. Puedes ver, reprogramar o cancelar aquí: {{link}}',
  },
  appointment_reminder_24h: {
    category: 'utility',
    params: ['name', 'service', 'date', 'time', 'business'],
    body: 'Hola {{name}}, te recordamos tu cita de *{{service}}* mañana {{date}} a las {{time}} en {{business}}. ¿Confirmas tu asistencia?',
    buttons: [
      { id: 'confirm', label: 'Confirmo' },
      { id: 'reschedule', label: 'Reprogramar' },
      { id: 'cancel', label: 'Cancelar' },
    ],
  },
  appointment_reminder_6h: {
    category: 'utility',
    params: ['name', 'service', 'time', 'business'],
    body: 'Hola {{name}}, hoy a las {{time}} tienes tu cita de *{{service}}* en {{business}}. ¡Te esperamos!',
    buttons: [
      { id: 'confirm', label: 'Confirmo' },
      { id: 'reschedule', label: 'Reprogramar' },
    ],
  },
  appointment_reminder_2h: {
    category: 'utility',
    params: ['name', 'service', 'time', 'address'],
    body: 'Hola {{name}}, en 2 horas (a las {{time}}) es tu cita de *{{service}}*. Dirección: {{address}}.',
  },
  appointment_rescheduled: {
    category: 'utility',
    params: ['name', 'service', 'date', 'time', 'link'],
    body: 'Hola {{name}}, tu cita de *{{service}}* fue reprogramada para el {{date}} a las {{time}}. Detalles: {{link}}',
  },
  appointment_canceled: {
    category: 'utility',
    params: ['name', 'service', 'date', 'time', 'business'],
    body: 'Hola {{name}}, tu cita de *{{service}}* del {{date}} a las {{time}} en {{business}} fue cancelada. Cuando quieras puedes agendar de nuevo.',
  },
  waitlist_offer: {
    category: 'utility',
    params: ['name', 'service', 'date', 'time', 'offerMinutes', 'link'],
    body: 'Hola {{name}}, se liberó un cupo para *{{service}}* el {{date}} a las {{time}}. Lo reservamos para ti por {{offerMinutes}} minutos: {{link}}',
    buttons: [{ id: 'accept', label: 'Lo quiero' }],
  },
  review_request: {
    category: 'utility',
    params: ['name', 'business', 'reviewUrl'],
    body: 'Gracias por visitarnos, {{name}}. ¿Cómo te fue en {{business}}? Cuéntanos tu experiencia: {{reviewUrl}}',
  },
  otp_code: {
    category: 'authentication',
    params: ['code'],
    body: 'Tu código de verificación es {{code}}. No lo compartas con nadie. Vence en 10 minutos.',
  },
  birthday_offer: {
    category: 'marketing',
    params: ['name', 'business', 'link'],
    body: '¡Feliz cumpleaños, {{name}}! En {{business}} tienes un regalo para ti. Reserva aquí: {{link}}',
  },
  winback: {
    category: 'marketing',
    params: ['name', 'business', 'link'],
    body: 'Hola {{name}}, te extrañamos en {{business}}. Agenda tu próxima cita cuando quieras: {{link}}',
  },
};

export function renderTemplate(name: TemplateName, params: TemplateParams): { body: string; buttons: TemplateButton[]; orderedParams: string[] } {
  const def = TEMPLATES[name];
  const body = def.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '');
  return {
    body,
    buttons: def.buttons ?? [],
    orderedParams: def.params.map((k) => params[k] ?? ''),
  };
}

/** Payload de los botones: `apt:{id}:{accion}`; el webhook lo usa para aplicar la accion. */
export const buildButtonPayload = (appointmentId: string, action: TemplateButton['id']): string => `apt:${appointmentId}:${action}`;

export function parseButtonPayload(payload: string): { appointmentId: string; action: TemplateButton['id'] } | null {
  const m = /^apt:([0-9a-fA-F-]{36}):(confirm|reschedule|cancel|accept)$/.exec(payload);
  return m ? { appointmentId: m[1]!, action: m[2] as TemplateButton['id'] } : null;
}
