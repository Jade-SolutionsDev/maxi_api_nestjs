import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { PublicProductsController } from './public-products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    forwardRef(() => AuthModule),
    CategoriesModule,
  ],
  controllers: [ProductsController, PublicProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
