import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Una línea tal y como debe quedar el pedido. */
export class OrderLineDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(9999)
  quantity: number;

  /**
   * Precio unitario. Si no viene: el que ya tenía la línea, o el del catálogo
   * si es nueva. Se acepta a mano porque un pedido viejo se corrige con los
   * precios de entonces, no con los de hoy.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999)
  unitPrice?: number;
}

/**
 * Corrección de las líneas de un pedido (capa 3). Se manda el pedido **como
 * debe quedar**, no las operaciones: es lo que ve quien lo edita, y evita que
 * dos correcciones simultáneas se sumen en silencio.
 */
export class UpdateOrderItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  /** Por qué se corrige. Va al historial tal cual. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
