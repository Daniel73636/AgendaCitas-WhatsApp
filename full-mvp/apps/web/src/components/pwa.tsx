'use client';
import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@agenda/ui';

/** Registra el service worker (solo en produccion para no interferir con HMR). */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
  }, []);
  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Banner "Instalar app" (Android/Chrome/Edge). En iOS se indica Compartir > Anadir a inicio. */
export function InstallPrompt({ className }: { className?: string }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (localStorage.getItem('agenda.install.dismissed')) return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (hidden || !evt) return null;
  return (
    <div className={className}>
      <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-secondary px-4 py-3 text-sm">
        <Download size={18} className="shrink-0 text-primary" />
        <span className="flex-1">Instala la app para abrirla como en tu celular o PC, sin barra del navegador.</span>
        <Button
          size="sm"
          onClick={async () => {
            await evt.prompt();
            const c = await evt.userChoice;
            if (c.outcome === 'accepted') setHidden(true);
          }}
        >
          Instalar
        </Button>
        <button
          aria-label="Ocultar"
          onClick={() => {
            localStorage.setItem('agenda.install.dismissed', '1');
            setHidden(true);
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
