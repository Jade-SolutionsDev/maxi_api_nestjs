import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserType } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { clerkId } });
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    if (createUserDto.clerkId) {
      await this.guardDuplicateClerkId(createUserDto.clerkId);
    }
    if (createUserDto.email) {
      await this.guardDuplicateEmail(createUserDto.email.toLowerCase());
    }

    const user = this.usersRepository.create({
      ...createUserDto,
      clerkId: createUserDto.clerkId ?? null,
      email: createUserDto.email?.toLowerCase() ?? null,
    });

    return this.usersRepository.save(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.email) {
      const email = updateUserDto.email.toLowerCase();
      await this.guardDuplicateEmail(email, id);
      user.email = email;
    }

    Object.assign(user, updateUserDto);
    return this.usersRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const result = await this.usersRepository.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
  }

  async createOrUpdateFromClerk(
    clerkId: string,
    data: {
      email?: string;
      firstName?: string;
      lastName?: string;
      userType?: UserType;
      phone?: string;
      businessName?: string;
    },
  ): Promise<User> {
    let user = await this.usersRepository.findOne({
      where: { clerkId },
      withDeleted: true,
    });

    if (!user) {
      if (data.email) {
        await this.guardDuplicateEmail(data.email.toLowerCase());
      }
      user = this.usersRepository.create({
        clerkId,
        email: data.email?.toLowerCase() ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phone: data.phone ?? null,
        businessName: data.businessName ?? null,
        userType: data.userType ?? UserType.STAFF,
        isActive: true,
      });
    } else {
      if (data.email) {
        await this.guardDuplicateEmail(data.email.toLowerCase(), user.id);
      }
      user.email = data.email?.toLowerCase() ?? user.email;
      user.firstName = data.firstName ?? user.firstName;
      user.lastName = data.lastName ?? user.lastName;
      user.phone = data.phone ?? user.phone;
      user.businessName = data.businessName ?? user.businessName;
      user.userType = data.userType ?? user.userType;
      user.isActive = true;
    }

    return this.usersRepository.save(user);
  }

  async deactivateByClerkId(clerkId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { clerkId } });
    if (!user) {
      return;
    }
    user.isActive = false;
    await this.usersRepository.save(user);
  }

  private async guardDuplicateEmail(
    email: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.usersRepository.findOne({
      where: { email },
      withDeleted: true,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A user with email "${email}" already exists`,
      );
    }
  }

  private async guardDuplicateClerkId(
    clerkId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.usersRepository.findOne({
      where: { clerkId },
      withDeleted: true,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A user with clerkId "${clerkId}" already exists`,
      );
    }
  }
}
