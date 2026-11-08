'use client';
import type { AuthSession } from '@agenda/contracts';
import { Button, Card, Field, Input } from '@agenda/ui';
import { CalendarCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { errMsg } from '@/lib/panel';

export default function LoginPage() {
  const router = useRouter();
  const { session, hydrated, setSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hydrated && session) router.replace('/hoy');
  }, [hydrated, session, router]);

  async function submit(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const s = await api<AuthSession>('/v1/auth/login', { method: 'POST', body: creds ?? { email, password } });
      setSession(s);
      router.replace('/hoy');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="rounded-2xl bg-primary p-3 text-primary-foreground"><CalendarCheck /></div>
        <h1 className="text-2xl font-bold">Panel del negocio</h1>
        <p className="text-sm text-muted-foreground">Inicia sesion para ver tu agenda.</p>
      </div>
      <Card className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Correo">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@negocio.com" />
          </Field>
          <Field label="Contrasena" error={error}>
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" loading={loading}>Entrar</Button>
        </form>
      </Card>
      <Button variant="outline" onClick={() => submit(undefined, { email: 'admin@belleza-demo.com', password: 'demo1234' })} disabled={loading}>
        Entrar con la cuenta demo
      </Button>
    </main>
  );
}
