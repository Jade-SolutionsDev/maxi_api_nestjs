import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Lo que el back-office necesita para dar de alta a alguien que compró por otro canal. */
export class InviteClientDto {
  @ApiProperty({ example: 'cliente@ejemplo.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Meylin' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Méndez' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}

/** Lo que el panel enseña después de invitar. */
export class ClientInvitationResponseDto {
  @ApiProperty()
  email: string;

  @ApiProperty({ description: 'Identificador de la invitación en Clerk.' })
  invitationId: string;

  @ApiProperty({
    description:
      'Enlace de aceptación. Se manda por correo, y se devuelve para poder ' +
      'dárselo a mano cuando el cliente no lo recibe.',
  })
  url: string;

  @ApiProperty({
    description: 'Si el correo con el enlace llegó a salir.',
  })
  emailSent: boolean;
}
