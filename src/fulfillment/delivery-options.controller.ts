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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import {
  CreateDeliveryOptionDto,
  DeliveryOptionResponseDto,
  UpdateDeliveryOptionDto,
} from './dto/delivery-option.dto';
import { FulfillmentService } from './fulfillment.service';

// The catalogue of ways the shop delivers. Empty is a legitimate state: it
// leaves pickup as the only thing a customer can choose.
@ApiTags('fulfillment')
@ApiBearerAuth()
@Controller('delivery-options')
export class DeliveryOptionsController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Get()
  @RequirePermission({ module: 'delivery-options', action: 'list' })
  @ApiOperation({ summary: 'All delivery options, enabled or not' })
  findAll(): Promise<DeliveryOptionResponseDto[]> {
    return this.fulfillmentService.findAllOptions();
  }

  @Get(':id')
  @RequirePermission({ module: 'delivery-options', action: 'read' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeliveryOptionResponseDto> {
    return this.fulfillmentService.findOneOption(id);
  }

  @Post()
  @RequirePermission({ module: 'delivery-options', action: 'create' })
  @ApiOperation({
    summary: 'Create a delivery option',
    description:
      'Zones are optional: an option with none is offered everywhere, one ' +
      'with zones only where they say (a zone without a municipality covers ' +
      'the whole province).',
  })
  create(
    @Body() dto: CreateDeliveryOptionDto,
  ): Promise<DeliveryOptionResponseDto> {
    return this.fulfillmentService.createOption(dto);
  }

  @Patch(':id')
  @RequirePermission({ module: 'delivery-options', action: 'update' })
  @ApiOperation({ summary: 'Edit an option; zones are replaced wholesale' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryOptionDto,
  ): Promise<DeliveryOptionResponseDto> {
    return this.fulfillmentService.updateOption(id, dto);
  }

  @Delete(':id')
  @RequirePermission({ module: 'delivery-options', action: 'delete' })
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove an option',
    description: 'Orders keep their own label and fee snapshot.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.fulfillmentService.removeOption(id);
  }
}
