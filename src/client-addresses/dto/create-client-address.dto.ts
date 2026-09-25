import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { IsCubanIdCard } from '../../common/decorators/is-cuban-id.decorator';

export class CreateClientAddressDto {
  /** Short name the customer gives it: "Casa", "Trabajo". */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  label?: string;

  /** Street and number. */
  @IsString()
  @IsNotEmpty()
  @Length(1, 300)
  street: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  betweenStreets?: string;

  /** Free-text landmark. */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reference?: string;

  /** Drives the delivery zone. Must exist in the geography catalog. */
  @IsUUID()
  municipalityId: string;

  /** Quien recibe el pedido aquí. */
  @IsOptional()
  @IsString()
  @Length(1, 150)
  recipientName?: string;

  /** Carnet de identidad del destinatario. 11 dígitos con fecha válida. */
  @IsOptional()
  @IsCubanIdCard()
  idCard?: string;

  /** When empty, the client's own phone is the one to call. */
  @IsOptional()
  @IsString()
  @Length(0, 20)
  contactPhone?: string;

  /** Ignored on the very first address, which is always the default. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
