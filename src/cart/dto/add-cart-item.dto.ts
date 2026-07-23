import { IsInt, IsUUID, Min } from 'class-validator';

export class AddCartItemDto {
  /** Product to add. Must be an active catalog product with stock. */
  @IsUUID()
  productId: string;

  /** Quantity to ADD to the line (increments if the product is already in the cart). */
  @IsInt()
  @Min(1)
  quantity: number;
}
