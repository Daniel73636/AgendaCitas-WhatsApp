'use client';
import type { HoldDto, OtpRequestResult, OtpVerifyResult, PublicAppointmentDto, PublicBusiness, PublicReminderFlags, ServiceDto, SlotDto, StaffDto } from '@agenda/contracts';
import { Badge, Button, Card, Field, Input, Modal, Select, Skeleton, Spinner, cn } from '@agenda/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCircle2, Clock, MessageCircle, ShieldCheck, Sparkles, Timer, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { COUNTRIES, durationLabel, fmtDateLong, fmtTime, initials, money, waLink } from '@/lib/format';
import { toast } from '@/lib/session';
import { AppointmentSummary } from './appointment-summary';
import { SlotPicker } from './slot-picker';

const STEPS = ['Servicio', 'Profesional', 'Horario', 'Tus datos'] as const;
type Phase = 'form' | 'otp';

interface Draft {
  step: 0 | 1 | 2 | 3;
  serviceIds: string[];
  staffId: string; // 'any' | uuid
  slot: SlotDto | null;
  hold: HoldDto | null;
  name: string;
  country: string;
  phone: string;
  email: string;
  consent: boolean;
  privacy: boolean;
  idemKey: string;
}
const emptyDraft = (): Draft => ({ step: 0, serviceIds: [], staffId: 'any', slot: null, hold: null, name: '', country: '+57', phone: '', email: '', consent: false, privacy: false, idemKey: newIdempotencyKey() });
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readStoredDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  const d = JSON.parse(raw) as Draft & { savedAt?: number };
  if (d.savedAt && Date.now() - d.savedAt > DRAFT_MAX_AGE_MS) return null;
  if (d.hold && Date.parse(d.hold.expiresAt) <= Date.now()) return { ...d, hold: null, slot: null, step: Math.min(d.step, 2) as Draft['step'] };
  return d;
}

/** Asistente de reserva: servicio, profesional, horario, datos y confirmación. El borrador vive en localStorage para seguir en otra pestaña. */
export function BookingWizard({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const biz = useQuery<PublicBusiness>({ queryKey: ['biz', slug], queryFn: () => api<PublicBusiness>(`/v1/public/${slug}`), staleTime: 60_000, retry: 1 });
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [done, setDone] = useState<PublicAppointmentDto | null>(null);
  const storageKey = `agenda.draft.${slug}`;
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const apply = (raw: string | null) => {
      try {
        const d = readStoredDraft(raw);
        if (d) setDraftState(d);
      } catch {
        /* ignorar borrador dañado */
      }
    };
    try {
      let raw = localStorage.getItem(storageKey);
      if (!raw) {
        raw = sessionStorage.getItem(storageKey);
        if (raw) localStorage.setItem(storageKey, raw);
      }
      sessionStorage.removeItem(storageKey);
      if (raw && !readStoredDraft(raw)) localStorage.removeItem(storageKey);
      apply(raw);
    } catch {
      /* modo privado */
    }
    setRestored(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) apply(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    try {
      const bc = new BroadcastChannel(storageKey);
      channelRef.current = bc;
      bc.onmessage = (ev: MessageEvent<{ type?: string; draft?: string }>) => {
        if (ev.data?.type === 'draft') apply(ev.data.draft ?? null);
        if (ev.data?.type === 'reset') setDraftState(emptyDraft());
      };
    } catch {
      /* BroadcastChannel no disponible */
    }
    return () => {
      window.removeEventListener('storage', onStorage);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [storageKey]);
  const setDraft = useCallback(
    (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) =>
      setDraftState((d) => {
        const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
        const raw = JSON.stringify({ ...next, savedAt: Date.now() });
        try { localStorage.setItem(storageKey, raw); } catch { /* sin espacio */ }
        channelRef.current?.postMessage({ type: 'draft', draft: raw });
        return next;
      }),
    [storageKey],
  );
  const reset = () => {
    try { localStorage.removeItem(storageKey); } catch { /* ignorar */ }
    channelRef.current?.postMessage({ type: 'reset' });
    setDraftState(emptyDraft());
    setDone(null);
  };

  if (biz.isLoading || !restored) return <WizardSkeleton />;
  if (biz.isError || !biz.data) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 p-6 text-center" role="alert">
        <p className="font-medium">No pudimos cargar este negocio</p>
        <p className="text-sm text-muted-foreground">{(biz.error as Error)?.message || 'Revisa tu conexión e intenta de nuevo.'}</p>
        <Button onClick={() => void biz.refetch()} loading={biz.isFetching}>Reintentar</Button>
      </div>
    );
  }
  const b = biz.data;

  if (done) {
    return (
      <Shell title="¡Reserva lista!" slug={slug} backHref={`/${slug}`}>
        <Confirmation apt={done} onChange={setDone} onNew={reset} otpMode={b.otpMode} demoMode={b.demoMode} reminders={b.settings.reminders} whatsappConsent={draft.consent} />
      </Shell>
    );
  }

  const selected = b.services.filter((s) => draft.serviceIds.includes(s.id));
  const eligibleStaff = b.staff.filter((s) => selected.every((sv) => s.serviceIds.includes(sv.id)));
  const goto = (step: Draft['step']) => setDraft({ step });
  const releaseHold = (hold: HoldDto | null) => {
    if (hold) void api(`/v1/public/${slug}/holds/${hold.holdId}`, { method: 'DELETE' }).catch(() => undefined);
  };

  return (
    <Shell title="Reservar cita" slug={slug} backHref={draft.step === 0 ? `/${slug}` : undefined} onBack={draft.step > 0 ? () => goto((draft.step - 1) as Draft['step']) : undefined}>
      <Progress step={draft.step} />
      <p className="mb-4 text-center text-xs text-muted-foreground">
        <Link href={`/${slug}/privacidad`} className="font-medium text-primary underline underline-offset-2">Política de privacidad</Link>
        {' '}· Ley 1581 de 2012
      </p>
      <div key={draft.step} className="animate-fade-in pb-32">
        {draft.step === 0 && (
          <ServicePicker
            services={b.services}
            selectedIds={draft.serviceIds}
            currency={b.tenant.currency}
            onChange={(ids) => setDraft({ serviceIds: ids, slot: null })}
            onNext={() => {
              const eligible = eligibleStaffFor(b, draft.serviceIds);
              // Un solo profesional: se salta el paso. Cero: se muestra el vacío para que cambie de servicios.
              setDraft({ step: eligible.length === 1 ? 2 : 1, staffId: eligible.length === 1 ? eligible[0]!.id : 'any' });
            }}
          />
        )}
        {draft.step === 1 && (
          <StaffPicker
            staff={eligibleStaff}
            selected={selected}
            value={draft.staffId}
            currency={b.tenant.currency}
            onChange={(id) => setDraft({ staffId: id, slot: null })}
            onNext={() => goto(2)}
          />
        )}
        {draft.step === 2 && (
          <SlotStep
            slug={slug}
            business={b}
            draft={draft}
            staff={eligibleStaff}
            selected={selected}
            onPick={(slot) => setDraft({ slot })}
            onHold={(hold) => {
              if (draft.hold && draft.hold.holdId !== hold.holdId) releaseHold(draft.hold);
              setDraft({ hold, step: 3 });
            }}
          />
        )}
        {draft.step === 3 && draft.hold && (
          <ContactStep
            slug={slug}
            business={b}
            draft={draft}
            setDraft={setDraft}
            hold={draft.hold}
            onExpired={() => {
              toast.error('Tu tiempo de reserva venció. Elige un horario de nuevo.');
              void qc.invalidateQueries({ queryKey: ['avail'] });
              setDraft({ hold: null, slot: null, step: 2 });
            }}
            onDone={(apt) => {
              try { localStorage.removeItem(storageKey); } catch { /* ignorar */ }
              channelRef.current?.postMessage({ type: 'reset' });
              setDone(apt);
            }}
            onChangeSlot={() => {
              releaseHold(draft.hold);
              setDraft({ hold: null, slot: null, step: 2 });
            }}
          />
        )}
      </div>
    </Shell>
  );
}

function eligibleStaffFor(b: PublicBusiness, serviceIds: string[]): StaffDto[] {
  return b.staff.filter((s) => serviceIds.every((id) => s.serviceIds.includes(id)));
}

// ---------------------------------------------------------------------------
// Marco comun: cabecera, progreso, barra fija inferior
// ---------------------------------------------------------------------------
function Shell({ title, slug, backHref, onBack, children }: { title: string; slug: string; backHref?: string | undefined; onBack?: (() => void) | undefined; children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur safe-top">
        {onBack ? (
          <button onClick={onBack} aria-label="Volver" className="rounded-full p-2 hover:bg-muted"><ArrowLeft size={20} /></button>
        ) : (
          <Link href={backHref ?? `/${slug}`} aria-label="Volver al negocio" className="rounded-full p-2 hover:bg-muted"><ArrowLeft size={20} /></Link>
        )}
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>
      <div className="px-4 pt-4">{children}</div>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-5" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-label={`Paso ${step + 1} de 4: ${STEPS[step]}`}>
      <div className="mb-2 flex justify-between text-xs font-medium text-muted-foreground">
        {STEPS.map((s, i) => (
          <span key={s} className={cn(i === step && 'text-primary', i < step && 'text-foreground')}>{i + 1}. {s}</span>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((step + 1) / 4) * 100}%` }} />
      </div>
    </div>
  );
}

/** Boton principal fijo abajo (alcanzable con el pulgar). */
function StickyBar({ children, summary }: { children: React.ReactNode; summary?: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur safe-bottom">
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-4 pt-3">
        {summary}
        {children}
      </div>
    </div>
  );
}

function WizardSkeleton() {
  return (
    <div className="mx-auto max-w-xl space-y-3 p-4">
      <Skeleton className="h-10" />
      <Skeleton className="h-2" />
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. ServicePicker
// ---------------------------------------------------------------------------
const CATEGORY_EMOJI: Record<string, string> = { Cabello: '💇', Barberia: '💈', Barbería: '💈', Unas: '💅', Uñas: '💅', Bienestar: '💆' };
const CATEGORY_LABEL: Record<string, string> = { Barberia: 'Barbería', Barbería: 'Barbería', Unas: 'Uñas', Uñas: 'Uñas' };

function ServicePicker({ services, selectedIds, currency, onChange, onNext }: { services: ServiceDto[]; selectedIds: string[]; currency: string; onChange: (ids: string[]) => void; onNext: () => void }) {
  const selected = services.filter((s) => selectedIds.includes(s.id));
  const total = selected.reduce((a, s) => a + s.priceCents, 0);
  const minutes = selected.reduce((a, s) => a + s.durationMin, 0);
  const groups = useMemo(() => {
    const m = new Map<string, ServiceDto[]>();
    for (const s of services) (m.get(s.category ?? 'Servicios') ?? m.set(s.category ?? 'Servicios', []).get(s.category ?? 'Servicios')!).push(s);
    return [...m.entries()];
  }, [services]);
  return (
    <>
      <h2 className="mb-1 text-xl font-bold">¿Qué te quieres hacer?</h2>
      <p className="mb-4 text-sm text-muted-foreground">Puedes elegir más de un servicio.</p>
      {services.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center" role="status">
          <p className="font-medium">No hay servicios para reservar en línea</p>
          <p className="mt-1 text-sm text-muted-foreground">Escríbele al negocio para agendar por otro medio.</p>
        </div>
      )}
      <div className="flex flex-col gap-5">
        {groups.map(([cat, list]) => (
          <section key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[cat] ?? cat}</h3>
            <div className="flex flex-col gap-2.5">
              {list.map((s) => {
                const active = selectedIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(active ? selectedIds.filter((x) => x !== s.id) : [...selectedIds, s.id])}
                    className={cn('flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition', active ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40')}
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-2xl">
                      {s.imageUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={s.imageUrl} alt="" className="h-full w-full object-cover" /> : CATEGORY_EMOJI[s.category ?? ''] ?? '✨'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight">{s.name}</p>
                      {s.description && <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock size={12} /> {durationLabel(s.durationMin)}</span>
                        {s.depositCents > 0 && <Badge tone="warning">Anticipo {money(s.depositCents, currency)}</Badge>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{money(s.priceCents, currency)}</span>
                      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border', active ? 'border-primary bg-primary text-white' : 'border-border')}>{active && <Check size={14} />}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <StickyBar
        summary={selected.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{selected.length} servicio{selected.length > 1 && 's'} · {durationLabel(minutes)}</span>
            <span className="text-base font-bold tabular-nums">{money(total, currency)}</span>
          </div>
        )}
      >
        <Button size="lg" disabled={selected.length === 0} onClick={onNext}>Continuar</Button>
      </StickyBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. StaffPicker
// ---------------------------------------------------------------------------
function StaffPicker({ staff, selected, value, currency, onChange, onNext }: { staff: StaffDto[]; selected: ServiceDto[]; value: string; currency: string; onChange: (id: string) => void; onNext: () => void }) {
  const priceFor = (s: StaffDto) => selected.reduce((a, sv) => a + (s.serviceOverrides.find((o) => o.serviceId === sv.id)?.priceCentsOverride ?? sv.priceCents), 0);
  const base = selected.reduce((a, s) => a + s.priceCents, 0);
  return (
    <>
      <h2 className="mb-1 text-xl font-bold">¿Con quién?</h2>
      <p className="mb-4 text-sm text-muted-foreground">Elige a tu profesional o deja que busquemos el primer horario libre.</p>
      <div className="flex flex-col gap-2.5">
        <button type="button" aria-pressed={value === 'any'} onClick={() => onChange('any')} className={cn('flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition', value === 'any' ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40')}>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Users /></div>
          <div className="flex-1">
            <p className="font-semibold">Cualquiera disponible</p>
            <p className="text-xs text-muted-foreground">Más horarios para elegir (recomendado)</p>
          </div>
          {value === 'any' && <CheckCircle2 className="text-primary" />}
        </button>
        {staff.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center" role="status">
            <p className="font-medium">Nadie del equipo realiza esta combinación</p>
            <p className="mt-1 text-sm text-muted-foreground">Quita un servicio o elige otra combinación para ver horarios.</p>
          </div>
        )}
        {staff.map((s) => (
          <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => onChange(s.id)} className={cn('flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition', value === s.id ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40')}>
            <Avatar name={s.displayName} color={s.color} photoUrl={s.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.displayName}</p>
              <p className="line-clamp-1 text-xs text-muted-foreground">{s.specialties.join(' · ') || s.bio}</p>
              {priceFor(s) !== base && <p className="text-xs text-primary">Total con este profesional: {money(priceFor(s), currency)}</p>}
            </div>
            {value === s.id && <CheckCircle2 className="text-primary" />}
          </button>
        ))}
      </div>
      <StickyBar><Button size="lg" disabled={staff.length === 0} onClick={onNext}>Ver horarios</Button></StickyBar>
    </>
  );
}

export function Avatar({ name, color, photoUrl, size = 56 }: { name: string; color: string; photoUrl?: string | null; size?: number }) {
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.34 }} aria-hidden>
      {initials(name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. SlotPicker + creacion del hold
// ---------------------------------------------------------------------------
function SlotStep({ slug, business, draft, staff, selected, onPick, onHold }: { slug: string; business: PublicBusiness; draft: Draft; staff: StaffDto[]; selected: ServiceDto[]; onPick: (s: SlotDto) => void; onHold: (h: HoldDto) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [alternatives, setAlternatives] = useState<SlotDto[]>([]);
  const [waitDate, setWaitDate] = useState<string | null>(null);
  const tz = business.tenant.timezone;
  const ids = draft.serviceIds.join(',');
  const staffNames = Object.fromEntries(staff.map((s) => [s.id, s.displayName]));

  async function takeHold(slot: SlotDto) {
    setBusy(true);
    setAlternatives([]);
    try {
      const hold = await api<HoldDto>(`/v1/public/${slug}/holds`, {
        method: 'POST',
        body: { serviceIds: draft.serviceIds, staffId: draft.staffId, startsAt: slot.start },
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      });
      onHold(hold);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'SLOT_TAKEN' || e.code === 'SLOT_UNAVAILABLE')) {
        toast.error('Ese horario acaba de ser tomado. Mira estas alternativas.');
        setAlternatives(e.alternatives ?? []);
        void qc.invalidateQueries({ queryKey: ['avail'] });
      } else toast.error(e instanceof Error ? e.message : 'No se pudo reservar el horario');
    } finally {
      setBusy(false);
    }
  }

  const total = selected.reduce((a, s) => a + s.priceCents, 0);
  return (
    <>
      <h2 className="mb-1 text-xl font-bold">Elige día y hora</h2>
      <p className="mb-4 text-sm text-muted-foreground">Horarios en hora de {business.tenant.name} ({tz.split('/')[1]?.replace('_', ' ')}).</p>
      <SlotPicker
        tz={tz}
        cacheKey={[slug, ids, draft.staffId]}
        buildPath={(from, to) => `/v1/public/${slug}/availability?serviceIds=${ids}&staffId=${draft.staffId}&from=${from}&to=${to}`}
        selected={draft.slot?.start}
        onSelect={(s) => { onPick(s); setAlternatives([]); }}
        staffNames={staffNames}
        showStaff={draft.staffId === 'any' && staff.length > 1}
        emptyStaffName={draft.staffId === 'any' ? undefined : staff.find((s) => s.id === draft.staffId)?.displayName}
        emptyAction={(date) => (
          <Button variant="outline" className="min-h-11" onClick={() => setWaitDate(date)}><Timer size={14} /> Avísame si se libera un cupo</Button>
        )}
      />
      {alternatives.length > 0 && (
        <Card className="mt-4 border-warning/50 bg-warning/10 p-3">
          <p className="mb-2 text-sm font-medium">Alternativas cercanas:</p>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((a) => (
              <button key={a.start} onClick={() => { onPick(a); void takeHold(a); }} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium hover:border-primary">
                <span className="cap-first inline-block">{fmtDateLong(a.start, tz)}</span> · {a.label}
              </button>
            ))}
          </div>
        </Card>
      )}
      <StickyBar
        summary={draft.slot && (
          <div className="flex items-center justify-between text-sm">
            <span className="first-letter:uppercase text-muted-foreground">{fmtDateLong(draft.slot.start, tz)} · {draft.slot.label}</span>
            <span className="font-bold tabular-nums">{money(total, business.tenant.currency)}</span>
          </div>
        )}
      >
        <Button size="lg" disabled={!draft.slot} loading={busy} onClick={() => draft.slot && takeHold(draft.slot)}>
          Reservar este horario
        </Button>
      </StickyBar>
      <WaitlistModal open={!!waitDate} onClose={() => setWaitDate(null)} slug={slug} date={waitDate} draft={draft} tz={tz} />
    </>
  );
}

function WaitlistModal({ open, onClose, slug, date, draft, tz }: { open: boolean; onClose: () => void; slug: string; date: string | null; draft: Draft; tz: string }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!date) return;
    setBusy(true);
    try {
      const { isoAt } = await import('@/lib/format');
      const { addDaysStr } = await import('@agenda/domain-booking');
      await api(`/v1/public/${slug}/waitlist`, {
        method: 'POST',
        body: {
          fullName: name, phone: `${draft.country}${phone.replace(/\D/g, '').replace(/^0+/, '')}`, serviceId: draft.serviceIds[0],
          staffId: draft.staffId === 'any' ? null : draft.staffId, windowStart: isoAt(date, 0, tz), windowEnd: isoAt(addDaysStr(date, 1), 0, tz), consentWhatsapp: true, privacyAccepted: privacy,
        },
      });
      toast.success('Listo: te avisaremos por WhatsApp si se libera un cupo.');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo registrar');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Lista de espera" size="sm" footer={<Button onClick={submit} loading={busy} disabled={name.length < 2 || phone.length < 7 || !privacy}>Anotarme</Button>}>
      <p className="mb-3 text-sm text-muted-foreground">Si alguien cancela ese día, te ofrecemos el cupo por WhatsApp y lo reservamos 10 minutos para ti.</p>
      <div className="flex flex-col gap-3">
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Celular (WhatsApp)"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="3001234567" /></Field>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          <span>Autorizo el tratamiento de mis datos personales según la <a href={`/${slug}/privacidad`} target="_blank" rel="noreferrer" className="font-medium text-primary underline">Política de privacidad</a>.</span>
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 4. ContactForm + OTP (+ temporizador del hold)
// ---------------------------------------------------------------------------
function useCountdown(expiresAt: string) {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

function ContactStep({ slug, business, draft, setDraft, hold, onExpired, onDone, onChangeSlot }: {
  slug: string; business: PublicBusiness; draft: Draft; setDraft: (p: Partial<Draft>) => void; hold: HoldDto;
  onExpired: () => void; onDone: (a: PublicAppointmentDto) => void; onChangeSlot: () => void;
}) {
  const tz = business.tenant.timezone;
  const left = useCountdown(hold.expiresAt);
  const [phase, setPhase] = useState<Phase>('form');
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (left === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpired();
    }
  }, [left, onExpired]);

  const digits = draft.phone.replace(/\D/g, '').replace(/^0+/, '');
  const e164 = `${draft.country}${digits}`;
  const phoneOk = /^\+[1-9]\d{7,14}$/.test(e164) && (draft.country !== '+57' || /^3\d{9}$/.test(digits));
  const nameOk = draft.name.trim().length >= 2;
  const emailOk = !draft.email || /^\S+@\S+\.\S+$/.test(draft.email);
  const privacyOk = draft.privacy;
  const formOk = nameOk && phoneOk && emailOk && privacyOk;
  const mm = String(Math.floor(left / 60)).padStart(1, '0');
  const ss = String(left % 60).padStart(2, '0');

  async function sendCode() {
    setTouched(true);
    if (!formOk) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<OtpRequestResult>(`/v1/public/${slug}/otp/request`, { method: 'POST', body: { phone: e164 } });
      setHint(r.hint ?? '');
      setPhase('otp');
      toast.info(r.mock ? 'Código enviado (modo demostración).' : 'Te enviamos un código por WhatsApp.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos enviar el código');
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndBook() {
    setBusy(true);
    setError('');
    try {
      const v = await api<OtpVerifyResult>(`/v1/public/${slug}/otp/verify`, { method: 'POST', body: { phone: e164, code } });
      const apt = await api<PublicAppointmentDto>(`/v1/public/${slug}/bookings`, {
        method: 'POST',
        headers: { 'Idempotency-Key': draft.idemKey },
        body: { holdId: hold.holdId, fullName: draft.name.trim(), phone: e164, email: draft.email || undefined, consentWhatsapp: draft.consent, privacyAccepted: draft.privacy, otpToken: v.otpToken },
      });
      onDone(apt);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HOLD_EXPIRED') onExpired();
      else setError(e instanceof Error ? e.message : 'No se pudo confirmar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={cn('mb-4 flex items-center justify-between rounded-2xl px-4 py-2.5 text-sm', left <= 60 ? 'bg-red-50 text-red-700' : 'bg-secondary text-secondary-foreground')} role="timer" aria-live="off">
        <span className="flex items-center gap-2"><Timer size={16} /> Reservamos tu hora por <b className="tabular-nums">{mm}:{ss}</b></span>
        <button onClick={onChangeSlot} className="text-xs underline underline-offset-2">Cambiar</button>
      </div>

      <Card className="mb-4 p-4 text-sm">
        <p className="font-semibold first-letter:uppercase">{fmtDateLong(hold.startsAt, tz)} · {fmtTime(hold.startsAt, tz)}</p>
        <p className="text-muted-foreground">{hold.services.map((s) => s.name).join(' + ')} · con {hold.staffName}</p>
        <p className="mt-1 font-bold tabular-nums">{money(hold.totalCents, hold.currency)}</p>
      </Card>

      <h2 className="mb-3 text-xl font-bold">Tus datos</h2>
      <div className="flex flex-col gap-4">
        <Field label="Nombre completo" error={touched && !nameOk ? 'Escribe tu nombre' : undefined}>
          <Input autoComplete="name" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder="Ej: Laura Gómez" disabled={phase === 'otp'} />
        </Field>
        <Field label="Celular (WhatsApp)" error={touched && !phoneOk ? 'Revisa tu número (Colombia: 10 dígitos, empieza por 3)' : undefined} hint="Aquí recibirás la confirmación y los recordatorios.">
          <div className="flex gap-2">
            <Select aria-label="País" className="w-28 shrink-0" value={draft.country} onChange={(e) => setDraft({ country: e.target.value })} disabled={phase === 'otp'}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
            </Select>
            <Input inputMode="tel" autoComplete="tel-national" value={draft.phone} onChange={(e) => setDraft({ phone: e.target.value })} placeholder="300 123 4567" disabled={phase === 'otp'} />
          </div>
        </Field>
        <Field label="Correo (opcional)" error={touched && !emailOk ? 'Correo inválido' : undefined}>
          <Input type="email" autoComplete="email" value={draft.email} onChange={(e) => setDraft({ email: e.target.value })} disabled={phase === 'otp'} />
        </Field>
        <label className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={draft.consent} onChange={(e) => setDraft({ consent: e.target.checked })} />
          <span>
            <span className="flex items-center gap-1.5 font-medium"><MessageCircle size={14} className="text-success" /> Quiero recibir recordatorios por WhatsApp</span>
            <span className="text-xs text-muted-foreground">Te escribiremos solo sobre esta cita: confirmación y recordatorios para que no se te pase. Puedes cancelar cuando quieras. Si no lo marcas, no te enviaremos recordatorios.</span>
          </span>
        </label>
        <label className={cn('flex items-start gap-3 rounded-2xl border bg-card p-3 text-sm', touched && !privacyOk ? 'border-red-400' : 'border-border')}>
          <input type="checkbox" required className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={draft.privacy} disabled={phase === 'otp'} onChange={(e) => setDraft({ privacy: e.target.checked })} aria-describedby="privacy-help" />
          <span>
            <span className="flex items-center gap-1.5 font-medium"><ShieldCheck size={14} className="text-primary" /> Autorizo el tratamiento de mis datos personales</span>
            <span id="privacy-help" className="text-xs text-muted-foreground">
              Los usaremos solo para gestionar tu cita, según la <a href={`/${slug}/privacidad`} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">Política de privacidad</a> (Ley 1581 de 2012). Es obligatorio para reservar.
            </span>
            {touched && !privacyOk && <span className="mt-1 block text-xs text-red-700" role="alert">Debes aceptar para continuar.</span>}
          </span>
        </label>

        {phase === 'otp' && (
          <Card className="animate-pop-in border-primary/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={16} className="text-primary" /> Ingresa el código de 6 dígitos enviado a {e164}</p>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="mt-3 h-12 text-center text-2xl tracking-[0.5em] tabular-nums"
              placeholder="······"
              aria-label="Código de verificación"
            />
            {hint && <p className="mt-2 rounded-lg bg-warning/20 px-3 py-1.5 text-xs text-warning-foreground"><Sparkles size={12} className="mr-1 inline" />{hint}</p>}
            <button type="button" className="mt-2 text-xs text-primary underline underline-offset-2" onClick={sendCode}>Reenviar código</button>
          </Card>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      </div>

      <StickyBar>
        {phase === 'form' ? (
          <Button size="lg" loading={busy} onClick={sendCode}>Enviar código y continuar</Button>
        ) : (
          <Button size="lg" loading={busy} disabled={code.length !== 6} onClick={verifyAndBook}>Verificar y confirmar reserva</Button>
        )}
      </StickyBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Confirmacion (y pago del anticipo si aplica)
// ---------------------------------------------------------------------------
function reminderCopy(flags: PublicReminderFlags, status: PublicAppointmentDto['status'], consent: boolean): string {
  if (status === 'pending' || status === 'held') return 'Los recordatorios se programan cuando la cita quede confirmada y hayas autorizado WhatsApp.';
  if (!consent) return 'No enviaremos recordatorios por WhatsApp porque no autorizaste los mensajes. Agrega la cita a tu calendario para no olvidarla.';
  const bits: string[] = [];
  if (flags.confirm) bits.push('la confirmación');
  if (flags.r24) bits.push('un aviso 24 horas antes');
  if (flags.r6) bits.push('otro 6 horas antes');
  if (flags.r2) bits.push('otro 2 horas antes');
  if (bits.length === 0) return 'Este negocio no tiene recordatorios automáticos. Guarda la cita en tu calendario.';
  return `Por WhatsApp te enviaremos ${bits.join(', ')}.`;
}

function Confirmation({ apt, onChange, onNew, otpMode, demoMode, reminders, whatsappConsent }: {
  apt: PublicAppointmentDto; onChange: (a: PublicAppointmentDto) => void; onNew: () => void; otpMode: 'mock' | 'real';
  demoMode: boolean; reminders: PublicReminderFlags; whatsappConsent: boolean;
}) {
  const [paying, setPaying] = useState(false);
  const pending = apt.status === 'pending';
  async function pay() {
    setPaying(true);
    try {
      onChange(await api<PublicAppointmentDto>(`/v1/public/appointments/${apt.token}/pay`, { method: 'POST' }));
      toast.success('Pago recibido. ¡Tu cita está confirmada!');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo procesar el pago');
    } finally {
      setPaying(false);
    }
  }
  return (
    <div className="flex flex-col gap-4 pb-10 animate-fade-in">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <div className={cn('flex h-16 w-16 items-center justify-center rounded-full text-white', pending ? 'bg-amber-500' : 'bg-success')}>
          {pending ? <Timer size={32} /> : <Check size={34} />}
        </div>
        <h2 className="text-2xl font-bold">{pending ? 'Falta el anticipo' : '¡Tu cita está confirmada!'}</h2>
        <p className="text-sm text-muted-foreground">
          {pending
            ? (demoMode ? 'En esta demostración puedes simular el pago del anticipo para asegurar el horario.' : 'El pago en línea no está habilitado. Coordina el anticipo con el negocio para no perder el horario.')
            : <>Te enviamos la confirmación por WhatsApp{otpMode === 'mock' ? ' (modo demo: se registra en el servidor y en el panel → Mensajes)' : ''}.</>}
        </p>
      </div>
      <AppointmentSummary apt={apt} />
      <Card className="p-4 text-sm">
        <p className="font-semibold">Recordatorios</p>
        <p className="mt-1 text-muted-foreground">{reminderCopy(reminders, apt.status, whatsappConsent)}</p>
      </Card>
      {pending && demoMode && (
        <Card className="border-warning/50 bg-warning/10 p-4">
          <p className="font-semibold">Pagar anticipo: {money(apt.depositRequiredCents, apt.currency)}</p>
          <p className="mb-3 text-sm text-muted-foreground">Pasarela simulada, solo en modo demostración. Tienes unos minutos antes de que el horario se libere.</p>
          <Button size="lg" className="w-full" loading={paying} onClick={pay}>Pagar ahora (simulado)</Button>
        </Card>
      )}
      {pending && !demoMode && apt.business.phone && (
        <a href={waLink(apt.business.phone, 'Hola, quiero coordinar el anticipo de mi cita')} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium hover:bg-muted">
          Escribir al negocio por WhatsApp
        </a>
      )}
      <Link href={`/${apt.business.slug}/cita/${apt.token}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-medium text-primary-foreground hover:bg-primary/90">
        <UserRound size={18} /> Ver o modificar mi cita
      </Link>
      <p className="text-center text-xs text-muted-foreground">
        <Link href={`/${apt.business.slug}/privacidad`} className="underline underline-offset-2">Política de privacidad</Link>
      </p>
      <Button variant="ghost" onClick={onNew}>Reservar otra cita</Button>
    </div>
  );
}
