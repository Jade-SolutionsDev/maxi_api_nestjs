import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkClientAuthGuard } from '../auth/guards/clerk-client-auth.guard';
import type { AuthenticatedClientRequest } from '../auth/types/authenticated-request';
import { Public } from '../common/decorators/public.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

// Authenticated storefront cart. @Public() bypasses the global backoffice
// AuthGuard; ClerkClientAuthGuard authenticates the storefront customer and
// attaches request.client (the pattern CLAUDE.md prescribes for client routes).
@ApiTags('storefront')
@ApiBearerAuth()
@Controller('cart')
@Public()
@UseGuards(ClerkClientAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({
    summary: "Get the authenticated customer's cart",
    description:
      'The cart is bound to the Clerk account, so it persists across devices. ' +
      'All prices (`unitPrice`, `lineTotal`, `subtotal`) are recalculated ' +
      'server-side from the live catalog on every read — never compute them ' +
      'client-side. Lines whose product went inactive or out of stock come ' +
      'back with `isAvailable: false`.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  getCart(@Req() req: AuthenticatedClientRequest): Promise<CartResponseDto> {
    return this.cartService.getCart(req.client.id);
  }

  @Post('items')
  @ApiOperation({
    summary: 'Add a product to the cart (increments an existing line)',
    description:
      'Adds `quantity` to the existing line, creating it if absent. The ' +
      'product must be active and the resulting quantity must not exceed the ' +
      'available stock. Returns the full recalculated cart.',
  })
  @ApiCreatedResponse({ type: CartResponseDto })
  @ApiConflictResponse({
    description:
      'Requested quantity exceeds available stock. ' +
      '`error.details[0].available` holds the current stock.',
  })
  addItem(
    @Req() req: AuthenticatedClientRequest,
    @Body() dto: AddCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cartService.addItem(req.client.id, dto.productId, dto.quantity);
  }

  @Patch('items/:productId')
  @ApiOperation({
    summary: 'Set the absolute quantity of a cart line',
    description:
      'Overwrites the line quantity (must be ≥ 1 — use DELETE to remove the ' +
      'line). Same stock validation as adding. Returns the full recalculated ' +
      'cart.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiConflictResponse({
    description:
      'Requested quantity exceeds available stock. ' +
      '`error.details[0].available` holds the current stock.',
  })
  updateItem(
    @Req() req: AuthenticatedClientRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cartService.updateItem(req.client.id, productId, dto.quantity);
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove a product from the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  removeItem(
    @Req() req: AuthenticatedClientRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartResponseDto> {
    return this.cartService.removeItem(req.client.id, productId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  clear(@Req() req: AuthenticatedClientRequest): Promise<CartResponseDto> {
    return this.cartService.clear(req.client.id);
  }
}
