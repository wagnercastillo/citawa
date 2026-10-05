import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../users/role.enum';
import { AuthUser } from './session';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<Request>().user as AuthUser,
);
