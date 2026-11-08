'use client';
import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type ApiOptions, api } from './api';
import { toast, useRealtime, useSession } from './session';

/** Contexto autenticado del panel (token, tenant, zona horaria de la sede). */
export function useAuthed() {
  const session = useSession((s) => s.session);
  return {
    token: session?.token ?? null,
    tenantId: session?.tenant.id ?? '',
    tz: session?.tenant.timezone ?? 'America/Bogota',
    currency: session?.tenant.currency ?? 'COP',
    slug: session?.tenant.slug ?? '',
    role: session?.user.role ?? 'staff',
    user: session?.user,
    tenant: session?.tenant,
  };
}

/** Consulta autenticada. Las claves incluyen el tenant. Sin SSE, refresca cada 30 s (fallback). */
export function usePQuery<T>(key: QueryKey, path: string | null, opts: { staleTime?: number; enabled?: boolean; refetchInterval?: number | false } = {}) {
  const { token, tenantId } = useAuthed();
  const connected = useRealtime((s) => s.connected);
  return useQuery<T, ApiError>({
    queryKey: [tenantId, ...key],
    queryFn: ({ signal }) => api<T>(path!, { token, signal }),
    enabled: !!token && !!path && (opts.enabled ?? true),
    staleTime: opts.staleTime ?? 10_000,
    refetchInterval: opts.refetchInterval ?? (connected ? false : 30_000),
    placeholderData: (prev) => prev,
  });
}

export function useApiMutation<TIn = void, TOut = unknown>(
  fn: (input: TIn, ctx: { token: string | null }) => Promise<TOut>,
  opts: { invalidate?: QueryKey[]; success?: string; onSuccess?: (out: TOut, input: TIn) => void; onError?: (e: ApiError, input: TIn) => void; silentError?: boolean } = {},
) {
  const { token, tenantId } = useAuthed();
  const qc = useQueryClient();
  return useMutation<TOut, ApiError, TIn>({
    mutationFn: (input) => fn(input, { token }),
    onSuccess: (out, input) => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: [tenantId, ...k] });
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(out, input);
    },
    onError: (e, input) => {
      if (!opts.silentError) toast.error(e.message);
      opts.onError?.(e, input);
    },
  });
}

export const authedApi = <T,>(path: string, token: string | null, o: Omit<ApiOptions, 'token'> = {}) => api<T>(path, { ...o, token });

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Ocurrio un error');
