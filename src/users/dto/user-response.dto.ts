import { User } from '../entities/user.entity';

export class UserResponseDto {
  id: string;
  clerkUserId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  userType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.clerkUserId = user.clerkUserId;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.email = user.email;
    dto.phone = user.phone;
    dto.userType = user.userType;
    dto.status = user.status;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
