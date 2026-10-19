import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { ApiTags } from '@nestjs/swagger';
import { HeapProfileService } from './heap-profile.service';
import { MemoryWatchService } from './memory-watch.service';
import type { MuestraDeMemoria } from './memory-watch.service';
import type { Perfil } from './heap-profile.service';

export interface HealthStatus {
  status: string;
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly memoryWatch: MemoryWatchService,
    private readonly heapProfile: HeapProfileService,
  ) {}

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

  /**
   * Arranca el muestreo de asignaciones (`MxH-0166`).
   *
   * Solo superadmin, y solo donde `HEAP_PROFILE_ENABLED` lo permita: abre el
   * inspector dentro del proceso, y eso no se deja encendido por si acaso.
   */
  @Roles(Role.SUPER_ADMIN)
  @Post('heap-profile/start')
  @HttpCode(200)
  async startHeapProfile(
    @Query('interval') intervalo?: string,
  ): Promise<{ corriendo: boolean }> {
    this.exigirPerfilHabilitado();
    const bytes = intervalo ? Number(intervalo) : 65536;
    if (!Number.isFinite(bytes) || bytes < 1024) {
      throw new BadRequestException('El intervalo va en bytes, mínimo 1024.');
    }
    await this.heapProfile.arrancar(bytes);
    return { corriendo: this.heapProfile.corriendo };
  }

  /** Lo acumulado hasta ahora, sin detener el muestreo. */
  @Roles(Role.SUPER_ADMIN)
  @Get('heap-profile')
  async getHeapProfile(@Query('top') top?: string): Promise<Perfil> {
    this.exigirPerfilHabilitado();
    if (!this.heapProfile.corriendo) {
      throw new BadRequestException('El muestreo no está arrancado.');
    }
    return this.heapProfile.leer(top ? Number(top) : 25);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('heap-profile/stop')
  @HttpCode(200)
  async stopHeapProfile(): Promise<{ corriendo: boolean }> {
    this.exigirPerfilHabilitado();
    await this.heapProfile.parar();
    return { corriendo: this.heapProfile.corriendo };
  }

  private exigirPerfilHabilitado(): void {
    if (!this.heapProfile.habilitado) {
      throw new ForbiddenException(
        'El perfilado del montón está apagado en este entorno.',
      );
    }
  }
}
