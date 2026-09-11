import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentInstructions } from '../entities/payment-method.entity';

/**
 * Instrucciones de pago. Un solo DTO con el tipo mandando qué es obligatorio:
 * `network` sólo se exige en cripto, y ahí no es opcional — mandar por la red
 * equivocada pierde los fondos.
 */
export class PaymentInstructionsDto {
  @IsIn(['bank', 'qr', 'link', 'crypto'])
  type: 'bank' | 'qr' | 'link' | 'crypto';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  // --- bank ---
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardNumber?: string;

  // --- qr ---
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  // --- link ---
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  url?: string;

  // --- crypto ---
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  /** Obligatoria en cripto. Validada en el servicio junto al resto del tipo. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  network?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  asset?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  memo?: string;
}

export class CreatePaymentMethodDto {
  @IsString()
  @MaxLength(80)
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ValidateNested()
  @Type(() => PaymentInstructionsDto)
  instructions: PaymentInstructionsDto;
}

/**
 * Lo que cada tipo necesita de verdad. class-validator no sabe de uniones
 * discriminadas, así que el contrato se cierra aquí y el servicio lo aplica.
 */
export const assertInstructions = (
  dto: PaymentInstructionsDto,
): PaymentInstructions => {
  switch (dto.type) {
    case 'bank':
      if (!dto.bankName?.trim()) {
        throw new Error('Falta el banco');
      }
      if (!dto.accountNumber?.trim() && !dto.cardNumber?.trim()) {
        throw new Error('Hace falta el número de cuenta o el de tarjeta');
      }
      return {
        type: 'bank',
        bankName: dto.bankName.trim(),
        accountHolder: dto.accountHolder?.trim() || null,
        accountNumber: dto.accountNumber?.trim() || null,
        cardNumber: dto.cardNumber?.trim() || null,
        note: dto.note?.trim() || null,
      };
    case 'qr':
      if (!dto.imageUrl?.trim()) {
        throw new Error('Falta la imagen del QR');
      }
      return {
        type: 'qr',
        imageUrl: dto.imageUrl.trim(),
        note: dto.note?.trim() || null,
      };
    case 'link':
      if (!dto.url?.trim()) {
        throw new Error('Falta el enlace de pago');
      }
      return {
        type: 'link',
        url: dto.url.trim(),
        note: dto.note?.trim() || null,
      };
    case 'crypto':
      if (!dto.address?.trim()) {
        throw new Error('Falta la dirección de la wallet');
      }
      if (!dto.network?.trim()) {
        throw new Error(
          'Falta la red: mandar por la red equivocada pierde los fondos',
        );
      }
      return {
        type: 'crypto',
        address: dto.address.trim(),
        network: dto.network.trim(),
        asset: dto.asset?.trim() || null,
        memo: dto.memo?.trim() || null,
        note: dto.note?.trim() || null,
      };
  }
};
