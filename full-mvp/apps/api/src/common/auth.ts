import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONFIG, type AppConfig } from './config';
import { AppError } from './errors';
import { verifyToken } from './tokens';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: 'owner' | 'staff';
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const OwnerOnly = () => SetMetadata(ROLES, ['owner']);

/** Inyecta el contexto autenticado (tenant, usuario, rol). */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.auth as AuthContext;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const queryToken: string | undefined = req.query?.token; // EventSource no permite cabeceras
    const raw = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
    const payload = verifyToken<{ sub: string; tid: string; role: 'owner' | 'staff' }>(raw, this.config.authSecret);
    if (!payload) throw new AppError('UNAUTHORIZED', 'Sesion invalida o expirada. Inicia sesion de nuevo.');
    req.auth = { userId: payload.sub, tenantId: payload.tid, role: payload.role } satisfies AuthContext;
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(payload.role)) throw new AppError('FORBIDDEN', 'No tienes permiso para esta accion.');
    return true;
  }
}
