'use client';
import type { AuthSession } from '@agenda/contracts';
import { create } from 'zustand';

const KEY = 'agenda.session.v1';

interface SessionState {
  session: AuthSession | null;
  hydrated: boolean;
  hydrate: () => void;
  setSession: (s: AuthSession | null) => void;
  logout: () => void;
}

export const useSession = create<SessionState>((set) => ({
  session: null,
  hydrated: false,
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      set({ session: raw ? (JSON.parse(raw) as AuthSession) : null, hydrated: true });
    } catch {
      set({ session: null, hydrated: true });
    }
  },
  setSession: (s) => {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
    set({ session: s });
  },
  logout: () => {
    localStorage.removeItem(KEY);
    set({ session: null });
  },
}));

// ---- Toasts ----
export interface Toast { id: number; tone: 'success' | 'error' | 'info'; text: string }
interface ToastState { items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }
let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set({ items: [...get().items, { ...t, id }] });
    setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));
export const toast = {
  success: (text: string) => useToasts.getState().push({ tone: 'success', text }),
  error: (text: string) => useToasts.getState().push({ tone: 'error', text }),
  info: (text: string) => useToasts.getState().push({ tone: 'info', text }),
};

// ---- Estado local de la interfaz del calendario (Zustand solo para UI) ----
export type CalendarView = 'day' | 'week' | 'month';
interface CalendarState {
  view: CalendarView;
  date: string; // YYYY-MM-DD en la zona de la sede
  staffFilter: string | 'all';
  setView: (v: CalendarView) => void;
  setDate: (d: string) => void;
  setStaffFilter: (s: string | 'all') => void;
}
export const useCalendarUi = create<CalendarState>((set) => ({
  view: 'day',
  date: '',
  staffFilter: 'all',
  setView: (view) => set({ view }),
  setDate: (date) => set({ date }),
  setStaffFilter: (staffFilter) => set({ staffFilter }),
}));

// ---- Estado de la conexion en tiempo real ----
export const useRealtime = create<{ connected: boolean; set: (v: boolean) => void }>((set) => ({ connected: false, set: (connected) => set({ connected }) }));
