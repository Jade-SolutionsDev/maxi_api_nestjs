import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartItem } from './entities/cart-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CartItem]),
    forwardRef(() => AuthModule),
    ProductsModule,
  ],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
