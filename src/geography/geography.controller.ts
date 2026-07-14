import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  MunicipalityResponseDto,
  ProvinceResponseDto,
} from './dto/geography-response.dto';
import { GeographyService } from './geography.service';

// Reference geography for Cuba. Public so the storefront can read it too; the
// backoffice dataProvider consumes the `provinces` / `municipalities` resources.
@ApiTags('geography')
@Controller()
@Public()
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  @Get('provinces')
  async listProvinces(): Promise<ProvinceResponseDto[]> {
    const provinces = await this.geographyService.listProvinces();
    return provinces.map(ProvinceResponseDto.fromEntity);
  }

  @Get('provinces/:id/municipalities')
  async listByProvince(
    @Param('id') id: string,
  ): Promise<MunicipalityResponseDto[]> {
    const municipalities = await this.geographyService.listMunicipalities(id);
    return municipalities.map(MunicipalityResponseDto.fromEntity);
  }

  @Get('municipalities')
  async listMunicipalities(
    @Query('provinceId') provinceId?: string,
  ): Promise<MunicipalityResponseDto[]> {
    const municipalities =
      await this.geographyService.listMunicipalities(provinceId);
    return municipalities.map(MunicipalityResponseDto.fromEntity);
  }
}
