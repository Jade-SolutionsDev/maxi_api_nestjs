import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { OperationType } from '../entities/inventory-operation.entity';
import { OperationItemDto } from './operation-item.dto';

export class CreateOperationDto {
  // Source storage the operation acts on.
  @IsUUID()
  locationId: string;

  @IsEnum(OperationType)
  type: OperationType;

  // Required only for TRANSFER (validated in the service).
  @IsOptional()
  @IsUUID()
  targetLocationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OperationItemDto)
  items: OperationItemDto[];
}
