import { Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [DispatchModule, TrackingModule],
  providers: [SimulatorService],
})
export class SimulatorModule {}
