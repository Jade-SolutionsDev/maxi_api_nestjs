import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsConfig } from '../config/configuration';
import {
  PickupRemindersService,
  ReminderSweepResult,
} from './pickup-reminders.service';

/**
 * Disparador de los recordatorios de recogida. Mismo patrón que el barrido de
 * caducidad: @Public() porque no hay usuario detrás, autenticado con el
 * secreto compartido y fuera de la documentación pública.
 *
 * Se engancha a un Schedule Job de Dokploy, una vez al día:
 *   node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+
 *     "/api/internal/orders/pickup-reminders",{method:"POST",
 *     headers:{"x-cron-secret":process.env.CRON_SECRET}})
 *     .then(r=>r.text()).then(console.log)'
 */
@ApiExcludeController()
@Controller('internal/orders')
@Public()
export class PickupRemindersController {
  constructor(
    private readonly pickupReminders: PickupRemindersService,
    private readonly configService: ConfigService,
  ) {}

  @Post('pickup-reminders')
  @HttpCode(200)
  async run(
    @Headers('x-cron-secret') provided?: string,
  ): Promise<ReminderSweepResult> {
    this.assertSecret(provided);
    return this.pickupReminders.sweep();
  }

  // Cerrado por defecto: sin secreto la ruta no existe, en vez de quedar un
  // endpoint sin autenticar que manda correos a clientes.
  private assertSecret(provided?: string): void {
    const expected =
      this.configService.get<PaymentsConfig>('payments')?.expiry.cronSecret;
    if (!expected) {
      throw new ServiceUnavailableException(
        'CRON_SECRET is not configured; pickup reminders are disabled',
      );
    }
    const a = Buffer.from(provided ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid cron secret');
    }
  }
}
