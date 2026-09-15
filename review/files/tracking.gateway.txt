import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DispatchScore } from '../data-store/interfaces';

// Namespace /rt carries every live update the web app cares about:
//  - courier_locations, an array of every courier, roughly once a second
//  - order_status, one order's new status the moment it changes
//  - dispatch_scored, the full scoring breakdown right after a courier
//    is offered an order
@WebSocketGateway({
  namespace: '/rt',
  cors: {
    origin: process.env.WEB_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    // No auth handshake needed for the alpha demo, the socket only ever
    // carries public-ish tracking data (positions, statuses, scores).
    void client;
  }

  handleDisconnect(client: Socket): void {
    void client;
  }

  emitCourierLocations(locations: { id: string; lat: number; lng: number; status: string }[]): void {
    this.server?.emit('courier_locations', locations);
  }

  emitOrderStatus(orderId: string, status: string): void {
    this.server?.emit('order_status', { order_id: orderId, status });
  }

  emitDispatchScored(orderId: string, scores: DispatchScore[]): void {
    this.server?.emit('dispatch_scored', { order_id: orderId, scores });
  }
}
