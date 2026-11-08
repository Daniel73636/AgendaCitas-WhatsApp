'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@agenda/ui';
import { useSession, useToasts } from '@/lib/session';

function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            'pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-left text-sm shadow-lg animate-pop-in',
            t.tone === 'success' && 'bg-emerald-600 text-white',
            t.tone === 'error' && 'bg-red-600 text-white',
            t.tone === 'info' && 'bg-slate-800 text-white',
          )}
        >
          {t.tone === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : t.tone === 'error' ? <XCircle size={18} className="mt-0.5 shrink-0" /> : <Info size={18} className="mt-0.5 shrink-0" />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: (n, e) => n < 2 && !(e instanceof Error && 'status' in e && [400, 401, 403, 404, 409, 412, 422].includes((e as { status: number }).status)), refetchOnWindowFocus: true },
        },
      }),
  );
  const hydrate = useSession((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return (
    <QueryClientProvider client={client}>
      {children}
      <ToastHost />
    </QueryClientProvider>
  );
}
