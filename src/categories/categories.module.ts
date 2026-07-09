import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Product } from '../products/entities/product.entity';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { DepartmentsController } from './departments.controller';
import { Category } from './entities/category.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, Product]),
    forwardRef(() => AuthModule),
  ],
  controllers: [CategoriesController, DepartmentsController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
