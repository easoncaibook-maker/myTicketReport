import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@ticketreport/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('请先登录');

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { enterprise: true, groupMembers: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('账号不可用，请联系管理员');
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      enterpriseId: user.enterpriseId,
      enterpriseName: user.enterprise?.name ?? null,
      groupIds: user.groupMembers.map((g) => g.groupId),
    };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) return false;
    if (!roles.includes(user.role)) {
      throw new ForbiddenException('没有执行该操作的权限');
    }
    return true;
  }
}
