import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

export interface HealthStatus {
  status: string;
  timestamp: string;
}

@Public()
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  getReady(): HealthStatus {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }
}
