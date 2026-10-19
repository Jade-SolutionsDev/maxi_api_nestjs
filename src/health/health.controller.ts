import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { ApiTags } from '@nestjs/swagger';
import { MemoryWatchService } from './memory-watch.service';
import type { MuestraDeMemoria } from './memory-watch.service';

export interface HealthStatus {
  status: string;
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly memoryWatch: MemoryWatchService) {}

  @Public()
  @Get()
  getHealth(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  getReady(): HealthStatus {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * El montón ahora mismo, sin esperar a la siguiente muestra del registro.
   *
   * No es público: el tamaño del montón y el tiempo en pie le dicen a quien
   * mire desde fuera cuándo conviene apretar.
   */
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get('memory')
  getMemory(): MuestraDeMemoria {
    return this.memoryWatch.medir();
  }
}
