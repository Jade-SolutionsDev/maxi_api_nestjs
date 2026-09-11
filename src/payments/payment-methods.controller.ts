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
import { Role } from '../users/entities/user.entity';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { PaymentMethodResponseDto } from './dto/payment-method-response.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Qué puede cobrar la tienda. Reservado a ADMIN/SUPER_ADMIN igual que usuarios
 * y permisos: quien gestiona esto decide a qué cuenta va el dinero, así que no
 * se concede por rol — se tiene o no se tiene.
 */
@ApiTags('payment-methods')
@ApiBearerAuth()
@Controller('payment-methods')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class PaymentMethodsController {
  constructor(private readonly methodsService: PaymentMethodsService) {}

  @Get()
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
