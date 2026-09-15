import { Module } from '@nestjs/common';
import { DataStoreModule } from './data-store/data-store.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { TrackingModule } from './tracking/tracking.module';
import { OpsModule } from './ops/ops.module';
import { SimulatorModule } from './simulator/simulator.module';

@Module({
  imports: [
    DataStoreModule,
    AuthModule,
    CatalogModule,
    OrdersModule,
    DispatchModule,
    TrackingModule,
    OpsModule,
    SimulatorModule,
  ],
})
export class AppModule {}
