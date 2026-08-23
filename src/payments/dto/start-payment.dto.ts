import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartPaymentDto {
  /** Payment method code. Omitted ⇒ the default enabled method. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  method?: string;
}
