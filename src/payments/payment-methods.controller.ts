import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { PaymentMethodResponseDto } from './dto/payment-method-response.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

// Which gateways the storefront may offer. Credentials are environment-owned;
// this only controls availability and presentation.
@ApiTags('payment-methods')
@ApiBearerAuth()
@Controller('payment-methods')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class PaymentMethodsController {
  constructor(private readonly methodsService: PaymentMethodsService) {}

  @Get()
  @ApiOperation({
    summary: 'Payment method catalog',
    description:
      'One entry per registered gateway. `configured: false` means the ' +
      'environment has no credentials for it — it cannot be enabled.',
  })
  @ApiOkResponse({ type: [PaymentMethodResponseDto] })
  findAll(): Promise<PaymentMethodResponseDto[]> {
    return this.methodsService.findAll();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Enable/disable a method or edit how it is presented',
  })
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.methodsService.update(id, dto);
  }
}
