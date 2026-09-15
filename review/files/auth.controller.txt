import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';
import { RateLimiter } from '../common/rate-limit';

// 5 attempts per minute per ip, kept simple and in memory since this is a
// single process alpha. Protects the demo logins from a brute force loop.
const loginLimiter = new RateLimiter(5, 60_000);

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!loginLimiter.check(ip)) {
      throw new HttpException(
        { message: 'Too many login attempts, please wait a minute and try again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.authService.login(body);
  }
}
