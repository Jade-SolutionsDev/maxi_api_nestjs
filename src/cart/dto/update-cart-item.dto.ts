import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  /** Absolute quantity for the line (use DELETE to remove it). */
  @IsInt()
  @Min(1)
  quantity: number;
}
