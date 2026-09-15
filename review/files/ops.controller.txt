import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OpsService } from './ops.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  // Live order and courier positions, earnings, and dispatch scoring
  // internals are ops-only, not just anything a valid token can see.
  @Get('state')
  @UseGuards(JwtAuthGuard)
  getState(@Req() req: Request) {
    const user = (req as any).user as { role: string };
    if (user.role !== 'ops') {
      throw new ForbiddenException('This view is for ops staff only.');
    }
    return this.opsService.getState();
  }
}
