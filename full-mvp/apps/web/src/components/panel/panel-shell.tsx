'use client';
import type { ConversationDto, RealtimeEvent } from '@agenda/contracts';
import { Spinner, cn } from '@agenda/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, CalendarDays, CalendarCheck, Clock, LayoutDashboard, LogOut, Menu, MessageSquare, Scissors, Settings, Users, UserSquare2, Wifi, WifiOff, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { InstallPrompt } from '@/components/pwa';
import { apiBase } from '@/lib/api';
import { useAuthed, usePQuery } from '@/lib/panel';
import { toast, useRealtime, useSession } from '@/lib/session';

const MAIN = [
  { href: '/hoy', label: 'Hoy', icon: LayoutDashboard },
  { href: '/calendario', label: 'Calendario', icon: CalendarDays },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/mensajes', label: 'Mensajes', icon: MessageSquare },
];
const MORE = [
  { href: '/servicios', label: 'Servicios', icon: Scissors },
  { href: '/equipo', label: 'Equipo', icon: UserSquare2 },
  { href: '/horarios', label: 'Horarios', icon: Clock },
  { href: '/reportes', label: 'Reportes', icon: BarChart3 },
  { href: '/ajustes', label: 'Ajustes', icon: Settings },
];

/** SSE por tenant: invalida solo las consultas afectadas; reconexion automatica (Last-Event-ID lo envia el navegador). */
function useRealtimeSync() {
  const { token, tenantId } = useAuthed();
  const qc = useQueryClient();
  const setConnected = useRealtime((s) => s.set);
  useEffect(() => {
    if (!token || typeof EventSource === 'undefined') return;
    const es = new EventSource(`${apiBase()}/v1/events?token=${encodeURIComponent(token)}`);
    const inv = (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [tenantId, k] }));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // el navegador reintenta solo; mientras tanto, polling cada 30 s
    const onApt = (e: MessageEvent) => {
      const ev = JSON.parse(e.data) as RealtimeEvent;
      inv('appointments', 'today', 'unconfirmed', 'report', 'waitlist');
      if (ev.type === 'appointment.created' && ev.data.status !== 'held') toast.info('Nueva cita en la agenda');
    };
    const onMsg = (e: MessageEvent) => {
      const ev = JSON.parse(e.data) as RealtimeEvent;
      inv('conversations', 'thread');
      if (ev.type === 'message.received') toast.info(`Nuevo mensaje de WhatsApp: ${String(ev.data.body ?? '').slice(0, 60)}`);
    };
    for (const t of ['appointment.created', 'appointment.updated', 'appointment.canceled']) es.addEventListener(t, onApt);
    for (const t of ['message.received', 'message.sent']) es.addEventListener(t, onMsg);
    return () => {
      es.close();
      setConnected(false);
    };
  }, [token, tenantId, qc, setConnected]);
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, hydrated, logout } = useSession();
  const connected = useRealtime((s) => s.connected);
  const [more, setMore] = useState(false);
  useRealtimeSync();
  const convs = usePQuery<ConversationDto[]>(['conversations'], '/v1/messages', { staleTime: 20_000 });
  const unread = (convs.data ?? []).reduce((a, c) => a + c.unread, 0);

  useEffect(() => {
    if (hydrated && !session) router.replace('/login');
  }, [hydrated, session, router]);
  useEffect(() => setMore(false), [pathname]);

  if (!hydrated || !session) {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner className="h-8 w-8 text-primary" /></div>;
  }
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const Item = ({ href, label, icon: Icon, badge }: { href: string; label: string; icon: typeof Menu; badge?: number }) => (
    <Link href={href} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', active(href) ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
      <Icon size={18} /> {label}
      {!!badge && <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
    </Link>
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Barra lateral (PC / tablet) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-border bg-card p-3 md:flex">
        <div className="mb-3 flex items-center gap-2 px-2 py-2">
          <div className="rounded-xl bg-primary p-2 text-primary-foreground"><CalendarCheck size={18} /></div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{session.tenant.name}</p>
            <a href={`/${session.tenant.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Ver pagina publica ↗</a>
          </div>
        </div>
        {MAIN.map((i) => <Item key={i.href} {...i} {...(i.href === '/mensajes' ? { badge: unread } : {})} />)}
        <p className="mt-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Configuracion</p>
        {MORE.map((i) => <Item key={i.href} {...i} />)}
        <div className="mt-auto flex flex-col gap-2">
          <InstallPrompt />
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground" title={connected ? 'Actualizaciones en vivo' : 'Sin conexion en vivo: se actualiza cada 30 s'}>
            {connected ? <Wifi size={14} className="text-success" /> : <WifiOff size={14} />} {connected ? 'En vivo' : 'Actualizacion periodica'}
          </div>
          <div className="flex items-center justify-between px-2 text-sm">
            <span className="truncate font-medium">{session.user.name}</span>
            <button aria-label="Cerrar sesion" onClick={() => { logout(); router.replace('/login'); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior (movil) */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur safe-top md:hidden">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary p-1.5 text-primary-foreground"><CalendarCheck size={16} /></div>
            <span className="font-bold">{session.tenant.name}</span>
          </div>
          <span className={cn('h-2.5 w-2.5 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/40')} title={connected ? 'En vivo' : 'Sin conexion en vivo'} />
        </header>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-10 md:pt-6">{children}</main>

        {/* Navegacion inferior (movil) */}
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card/95 backdrop-blur safe-bottom md:hidden" aria-label="Principal">
          {MAIN.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cn('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active(href) ? 'text-primary' : 'text-muted-foreground')}>
              <Icon size={20} /> {label}
              {href === '/mensajes' && unread > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{unread}</span>}
            </Link>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground"><Menu size={20} /> Mas</button>
        </nav>
        {more && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Mas opciones">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMore(false)} />
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-card p-4 pb-8 animate-slide-up">
              <div className="mb-2 flex items-center justify-between"><p className="font-semibold">Mas opciones</p><button onClick={() => setMore(false)} aria-label="Cerrar"><X size={20} /></button></div>
              <div className="grid grid-cols-3 gap-2">
                {MORE.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} className="flex flex-col items-center gap-1 rounded-2xl bg-muted px-2 py-4 text-xs font-medium"><Icon size={22} className="text-primary" />{label}</Link>
                ))}
                <button onClick={() => { logout(); router.replace('/login'); }} className="flex flex-col items-center gap-1 rounded-2xl bg-muted px-2 py-4 text-xs font-medium"><LogOut size={22} className="text-destructive" />Salir</button>
              </div>
              <InstallPrompt className="mt-3" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
