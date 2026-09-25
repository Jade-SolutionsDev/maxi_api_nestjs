import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { User } from '../users/entities/user.entity';
import { OrderEvent } from './entities/order-event.entity';
import { OrderEventsService } from './order-events.service';

/**
 * Historial de pedidos. Módulo aparte y sin dependencias de pedidos ni pagos
 * para que ambos puedan importarlo sin crear un ciclo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OrderEvent, User, Client])],
  providers: [OrderEventsService],
  exports: [OrderEventsService],
})
export class OrderEventsModule {}
