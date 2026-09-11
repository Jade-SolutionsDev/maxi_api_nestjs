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
import { CmsFaqCategory } from './entities/cms-faq-category.entity';
import { CmsFaqQuestion } from './entities/cms-faq-question.entity';
import { CmsFaqController } from './cms-faq.controller';
import { CmsFaqService } from './cms-faq.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CmsPage,
      CmsBanner,
      CmsServiceEntity,
      CmsStaffMember,
      CmsSiteSettings,
      CmsFaqCategory,
      CmsFaqQuestion,
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
    CmsFaqController,
    PublicCmsController,
  ],
  providers: [CmsService, CmsFaqService],
  exports: [CmsService, CmsFaqService],
})
export class CmsModule {}
