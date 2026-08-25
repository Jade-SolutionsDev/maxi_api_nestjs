import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import {
  FulfillmentSettingsResponseDto,
  UpdateFulfillmentSettingsDto,
} from './dto/fulfillment-settings.dto';
import { FulfillmentService } from './fulfillment.service';

// Singleton resource: GET/PATCH only, same shape as the CMS settings.
@ApiTags('fulfillment')
@ApiBearerAuth()
@Controller('fulfillment-settings')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class FulfillmentSettingsController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Get()
  @ApiOperation({
    summary: 'Pickup switch and support message',
    description:
      '`pickupEnabledWithoutAddresses` warns about the configuration that ' +
      'leaves customers nothing to choose: pickup on, no storage with an address.',
  })
  find(): Promise<FulfillmentSettingsResponseDto> {
    return this.fulfillmentService.getSettingsResponse();
  }

  @Patch()
  update(
    @Body() dto: UpdateFulfillmentSettingsDto,
  ): Promise<FulfillmentSettingsResponseDto> {
    return this.fulfillmentService.updateSettings(dto);
  }
}
