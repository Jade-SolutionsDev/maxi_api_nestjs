import { User } from '../entities/user.entity';

export class UserResponseDto {
  id: string;
  clerkId: string | null;
  role: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  businessName: string | null;
  businessDescription: string | null;
  businessLogoUrl: string | null;
  clerkOrgId: string | null;
  isActive: boolean;
  status?: 'active' | 'pending';
  isPending?: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(user: User, isPending = false): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.clerkId = user.clerkId;
    dto.role = user.role;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.phone = user.phone;
    dto.avatarUrl = user.avatarUrl;
    dto.businessName = user.businessName;
    dto.businessDescription = user.businessDescription;
    dto.businessLogoUrl = user.businessLogoUrl;
    dto.clerkOrgId = user.clerkOrgId;
    dto.isActive = user.isActive;
    dto.status = isPending ? 'pending' : 'active';
    dto.isPending = isPending;
    dto.createdBy = user.createdBy;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
