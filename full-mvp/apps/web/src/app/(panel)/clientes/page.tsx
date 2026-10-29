'use client';
import type { CustomerDto } from '@agenda/contracts';
import { Badge, Button, EmptyState, Input, Skeleton } from '@agenda/ui';
import { Plus, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CustomerForm } from '@/components/panel/customer-form';
import { fmtDateShort, initials, money } from '@/lib/format';
import { useAuthed, usePQuery } from '@/lib/panel';

export default function CustomersPage() {
  const { tz, currency } = useAuthed();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = usePQuery<CustomerDto[]>(['customers', 'list', debounced], `/v1/customers${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`, { staleTime: 5_000 });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Clientes</h1>
        <Button onClick={() => setCreating(true)}><Plus size={16} /> Nuevo cliente</Button>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-3.5 text-muted-foreground" />
        <Input className="h-11 pl-10" placeholder="Buscar por nombre o celular (tolera tildes y errores de tipeo)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clientes" />
      </div>
      {list.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
      {list.data?.length === 0 && <EmptyState icon={<Users size={32} />} title="Sin resultados" description="Prueba con otro nombre o crea un cliente nuevo." />}
      {list.data && list.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="hidden w-full text-sm md:table">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5">Cliente</th><th className="px-4 py-2.5">Celular</th><th className="px-4 py-2.5 text-right">Visitas</th><th className="px-4 py-2.5 text-right">Gastado</th><th className="px-4 py-2.5">Ultima visita</th><th className="px-4 py-2.5">Etiquetas</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2.5"><Link href={`/clientes/${c.id}`} className="font-medium text-primary hover:underline">{c.fullName}</Link></td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.visits}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(c.totalSpentCents, currency)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.lastVisitAt ? fmtDateShort(c.lastVisitAt, tz) : '—'}</td>
                  <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{c.noShowCount >= 2 && <Badge tone="danger">{c.noShowCount} inasist.</Badge>}{c.tags.map((t) => <Badge key={t} tone="primary">{t}</Badge>)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-border md:hidden">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link href={`/clientes/${c.id}`} className="flex items-center gap-3 p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">{initials(c.fullName)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.fullName}</span><span className="text-xs text-muted-foreground">{c.phone} · {c.visits} visitas</span></span>
                  {c.noShowCount >= 2 && <Badge tone="danger">{c.noShowCount}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {creating && <CustomerForm onClose={() => setCreating(false)} />}
    </div>
  );
}
