import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  MunicipalityResponseDto,
  ProvinceResponseDto,
} from './dto/geography-response.dto';
import { GeographyService } from './geography.service';

const isTrue = (v?: string): boolean => v === 'true' || v === '1';

// Reference data that changes on the order of months: let browsers/CDNs reuse
// it for an hour and serve stale for a day while revalidating in background.
const GEOGRAPHY_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';

// Reference geography for Cuba. Public so the storefront can read it too; the
// backoffice dataProvider consumes the `provinces` / `municipalities` resources.
@ApiTags('geography')
@Controller()
@Public()
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  // `all=true` bypasses the active-coverage filter (see the service). Default is
  // covered-only, so the storefront only offers deliverable provinces/municipalities.
  @Get('provinces')
  @Header('Cache-Control', GEOGRAPHY_CACHE)
  async listProvinces(
    @Query('all') all?: string,
  ): Promise<ProvinceResponseDto[]> {
    const provinces = await this.geographyService.listProvinces({
      all: isTrue(all),
    });
    return provinces.map(ProvinceResponseDto.fromEntity);
  }

  @Get('provinces/:id/municipalities')
  @Header('Cache-Control', GEOGRAPHY_CACHE)
  async listByProvince(
    @Param('id') id: string,
    @Query('all') all?: string,
  ): Promise<MunicipalityResponseDto[]> {
    const municipalities = await this.geographyService.listMunicipalities(id, {
      all: isTrue(all),
    });
    return municipalities.map(MunicipalityResponseDto.fromEntity);
  }

  @Get('municipalities')
  @Header('Cache-Control', GEOGRAPHY_CACHE)
  async listMunicipalities(
    @Query('provinceId') provinceId?: string,
    @Query('all') all?: string,
  ): Promise<MunicipalityResponseDto[]> {
    const municipalities = await this.geographyService.listMunicipalities(
      provinceId,
      { all: isTrue(all) },
    );
    return municipalities.map(MunicipalityResponseDto.fromEntity);
  }
}
