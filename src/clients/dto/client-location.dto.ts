import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * La zona que el cliente tiene guardada en su cuenta (MxH-0040).
 *
 * Es **dónde está el cliente**, no dónde se entrega un pedido concreto: eso
 * viaja en el checkout y se congela en la foto del pedido. Esta sirve para no
 * volver a preguntar la zona en cada dispositivo.
 */
export class ClientLocationResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Municipio guardado, o `null` si el cliente no ha elegido.',
  })
  municipalityId!: string | null;
}

export class SaveClientLocationDto {
  @ApiProperty({ description: 'Municipio que el cliente elige como su zona.' })
  @IsUUID()
  municipalityId!: string;
}
