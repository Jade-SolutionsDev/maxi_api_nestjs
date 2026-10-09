import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { Role } from '../users/entities/user.entity';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { PaymentMethodResponseDto } from './dto/payment-method-response.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Qué puede cobrar la tienda.
 *
 * **Gestionar** el catálogo sigue reservado a ADMIN/SUPER_ADMIN, igual que
 * usuarios y permisos: quien lo toca decide a qué cuenta va el dinero, así que
 * no se concede por rol — se tiene o no se tiene. Por eso el `@Roles` va en
 * cada escritura y no en la clase.
 *
 * **Leerlo** es otra cosa, y tenerlo cerrado era un defecto (MxH-0133, punto
 * 2): el panel pide este catálogo desde la pantalla de pedidos —para el filtro
 * por método y para el desplegable de «ya cobrado» al crear un pedido—, así que
 * un empleado con permiso de cobros se encontraba el filtro vacío y no podía
 * registrar un cobro. Se concede con `orders:list`, que es quien abre esa
 * pantalla.
 *
 * No enseña nada nuevo a quien ya la tiene abierta: la etiqueta del método de
 * cada pedido viaja en las propias filas del listado, y lo que devuelve este
 * DTO son campos de presentación. Las credenciales no están aquí —viven en el
 * entorno, ver `PaymentMethod`— y las instrucciones de pago no las devuelve.
 */
@ApiTags('payment-methods')
@ApiBearerAuth()
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methodsService: PaymentMethodsService) {}

  @Get()
  // Quien puede abrir la pantalla de pedidos es exactamente quien necesita
  // nombrar los métodos: para filtrar por uno y para elegir con cuál se cobró.
  @RequirePermission({ module: 'orders', action: 'list' })
  @ApiOperation({
    summary: 'Catálogo de métodos de pago',
    description:
      'Una fila por pasarela registrada más las que creó un admin. ' +
      '`configured: false` significa que el entorno no tiene credenciales ' +
      'para ella: no se puede activar.',
  })
  @ApiOkResponse({ type: [PaymentMethodResponseDto] })
  findAll(): Promise<PaymentMethodResponseDto[]> {
    return this.methodsService.findAll();
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Crear un método de pago manual',
    description:
      'Transferencia bancaria, QR, enlace o dirección de cripto. El cliente ' +
      've las instrucciones y alguien concilia el pago a mano.',
  })
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  create(
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.methodsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Activar/desactivar un método o editar cómo se presenta',
  })
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.methodsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Borrar un método manual',
    description:
      'Sólo los que creó un admin. Los pedidos ya pagados con él conservan ' +
      'su copia de las instrucciones.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.methodsService.remove(id);
  }
}
