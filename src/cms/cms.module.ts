import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { Category } from '../categories/entities/category.entity';
import { ProductsModule } from '../products/products.module';
import { Product } from '../products/entities/product.entity';
import { CmsBannersController } from './cms-banners.controller';
import { CmsPagesController } from './cms-pages.controller';
import { CmsService } from './cms.service';
import { CmsServicesController } from './cms-services.controller';
import { CmsSettingsController } from './cms-settings.controller';
import { CmsStaffController } from './cms-staff.controller';
import { CmsBanner } from './entities/cms-banner.entity';
import { CmsPage } from './entities/cms-page.entity';
import { CmsService as CmsServiceEntity } from './entities/cms-service.entity';
import { CmsSiteSettings } from './entities/cms-site-settings.entity';
import { CmsStaffMember } from './entities/cms-staff-member.entity';
import { PublicCmsController } from './public-cms.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CmsPage,
      CmsBanner,
      CmsServiceEntity,
      CmsStaffMember,
      CmsSiteSettings,
      Category,
      Product,
    ]),
    CategoriesModule,
    ProductsModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [
    CmsPagesController,
    CmsBannersController,
    CmsServicesController,
    CmsStaffController,
    CmsSettingsController,
    PublicCmsController,
  ],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
