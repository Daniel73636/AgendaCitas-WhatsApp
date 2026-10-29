'use client';
import type { TenantSettings } from '@agenda/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton, Switch, Textarea } from '@agenda/ui';
import { CheckCircle2, Copy, ExternalLink, MessageCircle, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';
import { toast, useSession } from '@/lib/session';

interface TenantView {
  id: string; slug: string; name: string; description: string | null; phone: string | null; currency: string; address: string | null; timezone: string;
  settings: TenantSettings; whatsapp: { mode: 'mock' | 'cloud'; connected: boolean; phoneNumberId: string | null }; otpMode: 'mock' | 'real'; publicUrl: string;
}

const num = (v: string) => Number(v.replace(/[^\d.]/g, '')) || 0;

export default function SettingsPage() {
  const { role } = useAuthed();
  const owner = role === 'owner';
  const q = usePQuery<TenantView>(['tenant'], '/v1/tenant', { staleTime: 20_000 });
  const [f, setF] = useState<{ name: string; description: string; phone: string; address: string; timezone: string; s: TenantSettings } | null>(null);
  useEffect(() => { if (q.data && !f) setF({ name: q.data.name, description: q.data.description ?? '', phone: q.data.phone ?? '', address: q.data.address ?? '', timezone: q.data.timezone, s: q.data.settings }); }, [q.data, f]);
  const session = useSession((s) => s.session);
  const setSession = useSession((s) => s.setSession);
  const save = useApiMutation(
    (_: void, { token }) => api<TenantView>('/v1/tenant', { method: 'PATCH', token, body: { name: f!.name, description: f!.description || null, phone: f!.phone || null, address: f!.address || null, timezone: f!.timezone, settings: f!.s } }),
    { invalidate: [['tenant'], ['onboarding']], success: 'Ajustes guardados', onSuccess: (t) => { if (session) setSession({ ...session, tenant: { ...session.tenant, name: t.name, timezone: t.timezone } }); } },
  );
  if (!q.data || !f) return <div className="mx-auto max-w-3xl space-y-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>;
  const t = q.data;
  const set = <K extends keyof TenantSettings>(k: K, v: TenantSettings[K]) => setF({ ...f, s: { ...f.s, [k]: v } });
  const dis = !owner;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Ajustes</h1>
        {owner && <Button loading={save.isPending} onClick={() => save.mutate()}>Guardar cambios</Button>}
      </div>
      {!owner && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">Solo el propietario puede modificar los ajustes.</p>}

      <Card>
        <CardHeader><CardTitle>Tu pagina de reservas</CardTitle><CardDescription>Comparte este enlace en Instagram, WhatsApp y Google.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-xl bg-muted px-3 py-2 text-sm">{typeof window !== 'undefined' ? `${window.location.origin}/${t.slug}` : t.publicUrl}</code>
          <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/${t.slug}`); toast.success('Enlace copiado'); }}><Copy size={14} /> Copiar</Button>
          <a href={`/${t.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted"><ExternalLink size={14} /> Abrir</a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Negocio</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre"><Input disabled={dis} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Telefono / WhatsApp"><Input disabled={dis} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Direccion" className="sm:col-span-2"><Input disabled={dis} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Descripcion" className="sm:col-span-2"><Textarea disabled={dis} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Zona horaria de la sede" hint="Todas las agendas y recordatorios usan esta zona."><Select disabled={dis} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Guayaquil', 'America/Caracas', 'Europe/Madrid', 'America/New_York'].map((z) => <option key={z}>{z}</option>)}
          </Select></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reglas de reserva</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Antelacion minima (min)" hint="No se ofrecen huecos mas cercanos a este tiempo."><Input disabled={dis} inputMode="numeric" value={f.s.minNoticeMin} onChange={(e) => set('minNoticeMin', num(e.target.value))} /></Field>
          <Field label="Reservas hasta (dias)"><Input disabled={dis} inputMode="numeric" value={f.s.maxAdvanceDays} onChange={(e) => set('maxAdvanceDays', num(e.target.value))} /></Field>
          <Field label="Paso de la grilla (min)"><Select disabled={dis} value={f.s.stepMin} onChange={(e) => set('stepMin', Number(e.target.value))}>{[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}</Select></Field>
          <Field label="Con 'Cualquiera'..."><Select disabled={dis} value={f.s.assignment} onChange={(e) => set('assignment', e.target.value as TenantSettings['assignment'])}><option value="least_loaded">Asignar al menos cargado del dia</option><option value="preference">Asignar por preferencia configurada</option></Select></Field>
          <Field label="Tiempo de bloqueo (hold, min)"><Input disabled={dis} inputMode="numeric" value={f.s.holdMinutes} onChange={(e) => set('holdMinutes', num(e.target.value))} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Politicas de cancelacion y anticipos</CardTitle><CardDescription>Se ejecutan automaticamente al cancelar.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Cancelar con al menos (h)"><Input disabled={dis} inputMode="numeric" value={f.s.cancelMinHours} onChange={(e) => set('cancelMinHours', num(e.target.value))} /></Field>
          <Field label="Reprogramar con al menos (h)"><Input disabled={dis} inputMode="numeric" value={f.s.rescheduleMinHours} onChange={(e) => set('rescheduleMinHours', num(e.target.value))} /></Field>
          <Field label="Devolucion total del anticipo desde (h antes)"><Input disabled={dis} inputMode="numeric" value={f.s.fullRefundHours} onChange={(e) => set('fullRefundHours', num(e.target.value))} /></Field>
          <Field label="Devolucion parcial desde (h antes)"><Input disabled={dis} inputMode="numeric" value={f.s.partialRefundHours} onChange={(e) => set('partialRefundHours', num(e.target.value))} /></Field>
          <Field label="% devuelto en parcial"><Input disabled={dis} inputMode="numeric" value={f.s.partialRefundPct} onChange={(e) => set('partialRefundPct', num(e.target.value))} /></Field>
          <div className="flex flex-col justify-end gap-2 sm:col-span-2">
            <Switch disabled={dis} checked={f.s.requireDepositForServices} onChange={(v) => set('requireDepositForServices', v)} label="Exigir el anticipo configurado en cada servicio" />
            <Switch disabled={dis} checked={f.s.depositOnRepeatNoShow} onChange={(v) => set('depositOnRepeatNoShow', v)} label={`Exigir anticipo (${f.s.riskDepositPct}% del total) a clientes con ${f.s.noShowThreshold}+ inasistencias`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recordatorios por WhatsApp</CardTitle><CardDescription>Se envian entre las 7:00 y las 21:00 hora local.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Switch disabled={dis} checked={f.s.reminders.confirm} onChange={(v) => set('reminders', { ...f.s.reminders, confirm: v })} label="Confirmacion inmediata" />
          <Switch disabled={dis} checked={f.s.reminders.r24} onChange={(v) => set('reminders', { ...f.s.reminders, r24: v })} label="24 horas antes (con botones)" />
          <Switch disabled={dis} checked={f.s.reminders.r6} onChange={(v) => set('reminders', { ...f.s.reminders, r6: v })} label="6 horas antes" />
          <Switch disabled={dis} checked={f.s.reminders.r2} onChange={(v) => set('reminders', { ...f.s.reminders, r2: v })} label="2 horas antes" />
          <Switch disabled={dis} checked={f.s.reminders.review} onChange={(v) => set('reminders', { ...f.s.reminders, review: v })} label="Solicitud de resena tras la cita" />
          <Field label="Enlace de resenas (opcional)"><Input disabled={dis} value={f.s.reviewUrl ?? ''} onChange={(e) => set('reviewUrl', e.target.value)} placeholder="https://g.page/r/..." /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle size={18} /> Conexion de WhatsApp Business</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            Estado: {t.whatsapp.connected ? <Badge tone="success"><CheckCircle2 size={12} /> Conectado (Cloud API)</Badge> : <Badge tone="warning">Modo simulado (mock)</Badge>}
            <Badge>OTP: {t.otpMode === 'mock' ? 'codigo 123456' : 'real'}</Badge>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>Crea una app en Meta for Developers y agrega el producto <b>WhatsApp</b>.</li>
            <li>Copia el <b>Phone number ID</b> y un <b>token permanente</b> a las variables <code>WHATSAPP_PHONE_NUMBER_ID</code> y <code>WHATSAPP_ACCESS_TOKEN</code> del archivo <code>.env</code>; usa <code>WHATSAPP_MODE=cloud</code>.</li>
            <li>Configura el webhook apuntando a <code>/v1/webhooks/whatsapp</code> con tu <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>.</li>
            <li>Crea y aprueba las plantillas: <code>appointment_confirmation</code>, <code>appointment_reminder_24h</code>, <code>appointment_reminder_2h</code>, <code>appointment_rescheduled</code>, <code>appointment_canceled</code>, <code>waitlist_offer</code>, <code>review_request</code>.</li>
          </ol>
          <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground"><Smartphone size={14} /> En modo simulado todos los mensajes se registran en la consola de la API y en <b>Mensajes</b>, sin enviarse a nadie.</p>
        </CardContent>
      </Card>
    </div>
  );
}
