import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  create(@Body() body: CreateOrderDto, @Req() req: Request) {
    const user = (req as any).user as { sub: string };
    const idempotencyKey = (req.headers['idempotency-key'] as string) || '';
    return this.ordersService.create(user.sub, body, idempotencyKey);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOne(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user as { sub: string; role: string };
    return this.ordersService.getById(id, user);
  }
}
