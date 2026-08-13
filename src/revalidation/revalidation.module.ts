import { Global, Module } from '@nestjs/common';
import { RevalidationService } from './revalidation.service';

// Global: any feature service can inject RevalidationService without importing
// this module — cache invalidation is a cross-cutting side effect, not a
// dependency worth wiring per module.
@Global()
@Module({
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
