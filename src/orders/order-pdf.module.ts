import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsModule } from '../cms/cms.module';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrderPdfService } from './order-pdf.service';
import { OrdersReportPdfService } from './orders-report-pdf.service';

/**
 * El comprobante del pedido en PDF, en un módulo propio.
 *
 * Vivía dentro de `OrdersModule`, y eso lo dejaba fuera del alcance del
 * correo: `OrdersModule` importa `MailModule`, así que si el correo hubiera
 * importado los pedidos para generar la factura, el círculo se cerraba y Nest
 * se planta. Aquí no depende de ninguno de los dos —solo de los repositorios
 * y del CMS, de donde salen los enlaces legales del pie—, así que los dos
 * pueden usarlo sin tocarse entre sí.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem]), CmsModule],
  providers: [OrderPdfService, OrdersReportPdfService],
  exports: [OrderPdfService, OrdersReportPdfService],
})
export class OrderPdfModule {}
