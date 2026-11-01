import { CalendarCheck, LayoutDashboard, MessageCircle, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { InstallPrompt } from '@/components/pwa';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-5 py-10">
      <div className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
          <MessageCircle size={14} /> Recordatorios por WhatsApp · PWA para PC y Android
        </span>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Agenda de citas con WhatsApp</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Tus clientes reservan en menos de un minuto, reciben recordatorios automaticos y tu equipo ve la agenda en tiempo real. Sin dobles reservas.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/belleza-demo" className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50 hover:shadow-md">
          <CalendarCheck className="mb-3 text-primary" />
          <p className="font-semibold">Ver pagina de reservas (cliente)</p>
          <p className="text-sm text-muted-foreground">Negocio demo “Belleza Demo”: elige servicio, profesional y horario. Codigo OTP de prueba: <b>123456</b>.</p>
        </Link>
        <Link href="/login" className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50 hover:shadow-md">
          <LayoutDashboard className="mb-3 text-primary" />
          <p className="font-semibold">Entrar al panel del negocio</p>
          <p className="text-sm text-muted-foreground">Hoy, calendario con arrastrar y soltar, clientes, mensajes y reportes. Usuario demo: <b>admin@belleza-demo.com</b> / <b>demo1234</b>.</p>
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
        <Smartphone className="mt-0.5 shrink-0" size={18} />
        <p>Instalable como aplicacion en Android (Chrome: menu ⋮ → “Instalar aplicacion”) y en el escritorio (icono de instalar en la barra de direcciones).</p>
      </div>
      <InstallPrompt />
    </main>
  );
}
