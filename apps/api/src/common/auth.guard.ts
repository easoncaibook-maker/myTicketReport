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
import { isAllowedWhileMustChangePassword } from './must-change-password';

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

    // 密码被重置 / 修改后，旧访问令牌（tokenVersion 落后）立即失效
    if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException('密码已修改，请重新登录');
    }

    // 强制改密：除查看自身信息与修改密码外，其余接口一律拦截
    if (user.mustChangePassword) {
      const path = String(req.path || req.url || '').split('?')[0];
      if (!isAllowedWhileMustChangePassword(req.method, path)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: '请先修改初始密码后再使用系统',
        });
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      enterpriseId: user.enterpriseId,
      enterpriseName: user.enterprise?.name ?? null,
      groupIds: user.groupMembers.map((g) => g.groupId),
      mustChangePassword: !!user.mustChangePassword,
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
