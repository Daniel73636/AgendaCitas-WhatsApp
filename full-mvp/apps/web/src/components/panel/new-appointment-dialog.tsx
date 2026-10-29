'use client';
import type { AppointmentDto, CustomerDto, ServiceDto, SlotDto, StaffDto } from '@agenda/contracts';
import { Badge, Button, Field, Input, Modal, Spinner, Switch, Textarea, cn } from '@agenda/ui';
import { AlertTriangle, Check, Search, ShieldAlert, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SlotPicker } from '@/components/booking/slot-picker';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { dayOf, durationLabel, fmtDateLong, isoAt, minutesOfDay, money, todayIn } from '@/lib/format';
import { errMsg, useApiMutation, useAuthed, usePQuery } from '@/lib/panel';

export interface NewAppointmentInitial {
  staffId?: string;
  startsAt?: string; // ISO
  customerId?: string;
}

/** Reserva manual del panel (QuickBook): cliente, servicios, profesional, horario libre u hora manual. */
export function NewAppointmentDialog({ open, onClose, initial, onCreated }: { open: boolean; onClose: () => void; initial?: NewAppointmentInitial | undefined; onCreated?: ((a: AppointmentDto) => void) | undefined }) {
  const { token, tz, currency } = useAuthed();
  const services = usePQuery<ServiceDto[]>(['services'], open ? '/v1/services' : null, { staleTime: 60_000 });
  const staff = usePQuery<StaffDto[]>(['staff'], open ? '/v1/staff' : null, { staleTime: 60_000 });

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string>(initial?.staffId ?? '');
  const [slotMode, setSlotMode] = useState<'free' | 'manual'>(initial?.startsAt ? 'manual' : 'free');
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [mDate, setMDate] = useState(initial?.startsAt ? dayOf(initial.startsAt, tz) : todayIn(tz));
  const [mTime, setMTime] = useState(initial?.startsAt ? `${String(Math.floor(minutesOfDay(initial.startsAt, tz) / 60)).padStart(2, '0')}:${String(minutesOfDay(initial.startsAt, tz) % 60).padStart(2, '0')}` : '10:00');
  const [outside, setOutside] = useState(false);
  const [notes, setNotes] = useState('');
  const [deposit, setDeposit] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [idem] = useState(newIdempotencyKey);
  const [alternatives, setAlternatives] = useState<SlotDto[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const found = usePQuery<CustomerDto[]>(['customers', 'search', debounced], open && mode === 'existing' && debounced.length >= 2 ? `/v1/customers?q=${encodeURIComponent(debounced)}` : null, { staleTime: 5_000 });
  const initialCustomer = usePQuery<CustomerDto>(['customer', initial?.customerId], open && initial?.customerId ? `/v1/customers/${initial.customerId}` : null);
  useEffect(() => {
    if (initialCustomer.data && !customer) setCustomer(initialCustomer.data);
  }, [initialCustomer.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = (services.data ?? []).filter((s) => serviceIds.includes(s.id));
  const eligible = (staff.data ?? []).filter((s) => s.active && selected.every((sv) => s.serviceIds.includes(sv.id)));
  useEffect(() => {
    if (staffId && !eligible.some((s) => s.id === staffId) && selected.length) setStaffId('');
  }, [serviceIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = selected.reduce((a, s) => a + s.priceCents, 0);
  const minutes = selected.reduce((a, s) => a + s.durationMin, 0);
  const noShows = customer?.noShowCount ?? 0;

  const startsAt = slotMode === 'free' ? slot?.start : mDate && mTime ? isoAt(mDate, Number(mTime.slice(0, 2)) * 60 + Number(mTime.slice(3, 5)), tz) : undefined;
  const phoneNorm = phone.replace(/[\s\-().]/g, '');
  const customerOk = mode === 'existing' ? !!customer : name.trim().length >= 2 && /^\+[1-9]\d{7,14}$/.test(phoneNorm);
  const canSubmit = customerOk && serviceIds.length > 0 && !!staffId && !!startsAt;

  const create = useApiMutation(
    (_: void, { token }) =>
      api<AppointmentDto>('/v1/appointments', {
        method: 'POST', token, headers: { 'Idempotency-Key': idem },
        body: {
          ...(mode === 'existing' ? { customerId: customer!.id } : { newCustomer: { fullName: name.trim(), phone: phoneNorm } }),
          serviceIds, staffId, startsAt, notes: notes || undefined, requireDeposit: deposit, sendConfirmation, ignoreSchedule: slotMode === 'manual' && outside,
        },
      }),
    {
      invalidate: [['appointments'], ['today'], ['unconfirmed'], ['customers']],
      success: 'Cita creada',
      silentError: true,
      onSuccess: (a) => { onCreated?.(a); onClose(); },
      onError: (e) => { setError(e.message); setAlternatives(e.alternatives ?? []); },
    },
  );

  const cacheKey = useMemo(() => ['panel', serviceIds.join(','), staffId], [serviceIds, staffId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva cita"
      size="lg"
      footer={
        <>
          <div className="mr-auto text-sm text-muted-foreground">
            {selected.length > 0 && <>{durationLabel(minutes)} · <b className="text-foreground">{money(total, currency)}</b></>}
          </div>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!canSubmit} loading={create.isPending} onClick={() => { setError(''); setAlternatives([]); create.mutate(); }}>Crear cita</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Cliente */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Cliente</h3>
            <div className="flex rounded-lg bg-muted p-0.5 text-xs">
              {(['existing', 'new'] as const).map((m) => (
                <button key={m} onClick={() => { setMode(m); setCustomer(null); }} className={cn('rounded-md px-2.5 py-1 font-medium', mode === m && 'bg-card shadow-sm')}>
                  {m === 'existing' ? 'Buscar' : <span className="inline-flex items-center gap-1"><UserPlus size={12} /> Nuevo</span>}
                </button>
              ))}
            </div>
          </div>
          {mode === 'existing' ? (
            customer ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{customer.fullName}</p>
                  <p className="text-xs text-muted-foreground">{customer.phone} · {customer.visits} visitas</p>
                </div>
                <button className="text-xs text-primary" onClick={() => setCustomer(null)}>Cambiar</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Nombre o celular (tolera errores de tipeo)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                </div>
                {found.isFetching && <Spinner className="h-4 w-4 text-muted-foreground" />}
                {found.data && (
                  <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                    {found.data.slice(0, 8).map((c) => (
                      <li key={c.id}>
                        <button className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted" onClick={() => setCustomer(c)}>
                          <span className="text-sm">{c.fullName} <span className="text-xs text-muted-foreground">{c.phone}</span></span>
                          {c.noShowCount >= 2 && <Badge tone="danger">{c.noShowCount} inasistencias</Badge>}
                        </button>
                      </li>
                    ))}
                    {found.data.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados. Usa “Nuevo”.</li>}
                  </ul>
                )}
              </>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Celular (con +pais)" hint="Ej: +573001234567"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            </div>
          )}
          {/* NoShowShield */}
          {noShows >= 2 && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-red-50 p-3 text-sm">
              <ShieldAlert className="mt-0.5 shrink-0 text-destructive" size={18} />
              <div className="flex-1">
                <p className="font-medium text-red-800">Este cliente tiene {noShows} inasistencias</p>
                <p className="text-red-700/80">Te sugerimos exigir un anticipo para asegurar el cupo.</p>
              </div>
              <Button size="sm" variant={deposit ? 'default' : 'outline'} onClick={() => setDeposit(true)}>{deposit ? <><Check size={14} /> Exigido</> : 'Exigir anticipo'}</Button>
            </div>
          )}
        </section>

        {/* Servicios */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Servicios</h3>
          <div className="flex flex-wrap gap-2">
            {(services.data ?? []).filter((s) => s.active).map((s) => {
              const on = serviceIds.includes(s.id);
              return (
                <button key={s.id} onClick={() => { setServiceIds(on ? serviceIds.filter((x) => x !== s.id) : [...serviceIds, s.id]); setSlot(null); }} className={cn('rounded-xl border px-3 py-2 text-left text-sm transition', on ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}>
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">{durationLabel(s.durationMin)} · {money(s.priceCents, currency)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Profesional */}
        {serviceIds.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Profesional</h3>
            <div className="flex flex-wrap gap-2">
              {eligible.map((s) => (
                <button key={s.id} onClick={() => { setStaffId(s.id); setSlot(null); }} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm', staffId === s.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} /> {s.displayName}
                </button>
              ))}
              {eligible.length === 0 && <p className="text-sm text-muted-foreground">Ningun profesional realiza todos los servicios seleccionados.</p>}
            </div>
          </section>
        )}

        {/* Horario */}
        {serviceIds.length > 0 && staffId && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Horario</h3>
              <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                <button onClick={() => setSlotMode('free')} className={cn('rounded-md px-2.5 py-1 font-medium', slotMode === 'free' && 'bg-card shadow-sm')}>Huecos libres</button>
                <button onClick={() => setSlotMode('manual')} className={cn('rounded-md px-2.5 py-1 font-medium', slotMode === 'manual' && 'bg-card shadow-sm')}>Hora manual</button>
              </div>
            </div>
            {slotMode === 'free' ? (
              <SlotPicker
                tz={tz}
                token={token}
                cacheKey={cacheKey}
                buildPath={(from, to) => `/v1/availability?serviceIds=${serviceIds.join(',')}&staffId=${staffId}&from=${from}&to=${to}`}
                selected={slot?.start}
                onSelect={setSlot}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fecha"><Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></Field>
                  <Field label="Hora"><Input type="time" step={300} value={mTime} onChange={(e) => setMTime(e.target.value)} /></Field>
                </div>
                <Switch checked={outside} onChange={setOutside} label="Permitir fuera de horario laboral (sobrecupo). Nunca se permiten solapes." />
              </div>
            )}
            {startsAt && <p className="text-sm text-muted-foreground">Cita: <b className="first-letter:uppercase text-foreground">{fmtDateLong(startsAt, tz)}</b></p>}
          </section>
        )}

        <section className="grid gap-3">
          <Field label="Notas (opcional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: alergia al amoniaco, prefiere tinte sin olor..." /></Field>
          <div className="flex flex-col gap-2">
            <Switch checked={deposit} onChange={setDeposit} label="Exigir anticipo (la cita queda pendiente hasta registrar el pago)" />
            <Switch checked={sendConfirmation} onChange={setSendConfirmation} label="Enviar confirmacion por WhatsApp" />
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> {error}</p>
            {alternatives.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {alternatives.map((a) => (
                  <button key={a.start} onClick={() => { setSlotMode('manual'); setMDate(dayOf(a.start, tz)); setMTime(a.label); setError(''); setAlternatives([]); }} className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium">
                    {fmtDateLong(a.start, tz)} {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {create.isError && !error && <p className="text-sm text-destructive">{errMsg(create.error)}</p>}
      </div>
    </Modal>
  );
}

export function QuickBookButton({ initial, label = 'Nueva cita', className }: { initial?: NewAppointmentInitial; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>+ {label}</Button>
      {open && <NewAppointmentDialog open={open} onClose={() => setOpen(false)} initial={initial} />}
    </>
  );
}
