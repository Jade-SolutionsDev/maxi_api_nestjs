import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HeapProfileService } from './heap-profile.service';
import { MemoryWatchService } from './memory-watch.service';

@Module({
  controllers: [HealthController],
  providers: [MemoryWatchService, HeapProfileService],
  exports: [MemoryWatchService],
})
export class HealthModule {}
