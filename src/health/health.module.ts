import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MemoryWatchService } from './memory-watch.service';

@Module({
  controllers: [HealthController],
  providers: [MemoryWatchService],
  exports: [MemoryWatchService],
})
export class HealthModule {}
