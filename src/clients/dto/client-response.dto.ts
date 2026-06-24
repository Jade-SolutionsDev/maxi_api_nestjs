import { Client } from '../entities/client.entity';

export class ClientResponseDto {
  id: string;
  clerkId: string;
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

  static fromEntity(client: Client): ClientResponseDto {
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
    return dto;
  }
}
