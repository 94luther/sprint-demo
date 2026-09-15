import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [TrackingModule],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
