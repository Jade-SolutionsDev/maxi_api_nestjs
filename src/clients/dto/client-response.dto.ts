import { Client } from '../entities/client.entity';

export class ClientResponseDto {
  id: string;
  /** Null en una invitación pendiente: todavía no hay cuenta en Clerk. */
  clerkId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  defaultMunicipalityId: string | null;
  isActive: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Invitado que aún no ha activado su cuenta. El panel lo usa para marcar la
   * fila y ofrecer reenviar o revocar en vez de abrir una ficha que no existe.
   */
  isPending?: boolean;

  static fromEntity(client: Client, isPending = false): ClientResponseDto {
    const dto = new ClientResponseDto();
    dto.id = client.id;
    dto.clerkId = client.clerkId;
    dto.email = client.email;
    dto.firstName = client.firstName;
    dto.lastName = client.lastName;
    dto.phone = client.phone;
    dto.avatarUrl = client.avatarUrl;
    dto.defaultMunicipalityId = client.defaultMunicipalityId;
    dto.isActive = client.isActive;
    dto.onboardingCompleted = client.onboardingCompleted;
    dto.createdAt = client.createdAt;
    dto.updatedAt = client.updatedAt;
    dto.isPending = isPending;
    return dto;
  }
}
