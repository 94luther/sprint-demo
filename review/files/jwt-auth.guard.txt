import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

// Reads "Authorization: Bearer <token>", verifies it with the HS256 secret
// from .env, and attaches the decoded payload to request.user. Any
// controller that needs a logged in caller applies this guard.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const secret = process.env.JWT_SECRET as string;
      const payload = jwt.verify(token, secret) as any;
      req.user = { sub: payload.sub, role: payload.role, name: payload.name };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
