import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  buildPaginatedResponse,
  getPaginationParams,
  PaginatedResponse,
  PaginationQueryDto,
} from '../common/dto/pagination.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role, User } from './entities/user.entity';
import { Invitation, InvitationStatus } from './entities/invitation.entity';

export interface FindUsersFilter {
  q?: string;
  isActive?: boolean;
  role?: Role;
  includeInvitations?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Invitation)
    private readonly invitationRepository: Repository<Invitation>,
  ) {}

  async findAll(
    filter: FindUsersFilter = {},
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResponse<User>> {
    const { page, limit, skip } = getPaginationParams(pagination);

    const qb = this.usersRepository.createQueryBuilder('user');
    if (filter.q) {
      qb.andWhere(
        '(user.firstName ILIKE :q OR user.lastName ILIKE :q OR user.email ILIKE :q OR user.phone ILIKE :q OR user.businessName ILIKE :q)',
        { q: `%${filter.q}%` },
      );
    }
    if (filter.role) {
      qb.andWhere('user.role = :role', { role: filter.role });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: filter.isActive });
    }
    qb.orderBy('user.createdAt', 'DESC').skip(skip).take(limit);

    const [users, usersTotal] = await qb.getManyAndCount();

    let items = users;
    let total = usersTotal;

    if (filter.includeInvitations) {
      // Pending invitations are surfaced as synthetic (not-yet-registered)
      // users. They are counted in `total` and pinned to the first page.
      const pendingUsers = await this.loadPendingInvitationUsers();
      total += pendingUsers.length;
      if (page === 1) {
        items = [...pendingUsers, ...users];
      }
    }

    return buildPaginatedResponse(items, total, page, limit);
  }

  private async loadPendingInvitationUsers(): Promise<User[]> {
    const invitations = await this.invitationRepository.find({
      where: { status: InvitationStatus.PENDING },
    });

    return invitations.map((invitation) => {
      const user = new User();
      user.id = invitation.id;
      user.clerkId = null;
      user.role = invitation.role;
      user.email = invitation.email;
      user.firstName = invitation.firstName;
      user.lastName = invitation.lastName;
      user.phone = null;
      user.avatarUrl = null;
      user.businessName = null;
      user.businessDescription = null;
      user.businessLogoUrl = null;
      user.clerkOrgId = invitation.organizationId;
      user.isActive = false;
      user.createdBy = invitation.invitedById;
      user.createdAt = invitation.createdAt;
      user.updatedAt = invitation.updatedAt;
      return user;
    });
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

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    actor?: User,
  ): Promise<User> {
    const user = await this.findOne(id);

    const isSelf = actor?.id === id;
    if (isSelf) {
      if (updateUserDto.role && updateUserDto.role !== user.role) {
        throw new ForbiddenException('Cannot change your own role');
      }
      if (updateUserDto.isActive === false) {
        throw new ForbiddenException('Cannot deactivate your own account');
      }
    }

    const demotingSuperAdmin =
      user.role === Role.SUPER_ADMIN &&
      !!updateUserDto.role &&
      updateUserDto.role !== Role.SUPER_ADMIN;
    const disablingSuperAdmin =
      user.role === Role.SUPER_ADMIN && updateUserDto.isActive === false;
    if (demotingSuperAdmin || disablingSuperAdmin) {
      await this.assertNotLastSuperAdmin();
    }

    Object.assign(user, updateUserDto);
    if (updateUserDto.email) {
      const email = updateUserDto.email.toLowerCase();
      await this.guardDuplicateEmail(email, id);
      user.email = email;
    }

    return this.usersRepository.save(user);
  }

  async remove(id: string, actor?: User): Promise<void> {
    const user = await this.findOne(id);

    if (actor?.id === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }
    if (user.role === Role.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin();
    }

    await this.usersRepository.update(id, { isActive: false });
    await this.usersRepository.softDelete(id);
  }

  async restore(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    if (!user.deletedAt) {
      return user;
    }

    // Dedupe-on-restore: block if an active row now owns the same email/clerkId.
    // findOne excludes soft-deleted rows, so the target itself is not matched.
    if (user.email) {
      const clash = await this.usersRepository.findOne({
        where: { email: user.email },
      });
      if (clash) {
        throw new ConflictException(
          `Another active user with email "${user.email}" already exists`,
        );
      }
    }
    if (user.clerkId) {
      const clash = await this.usersRepository.findOne({
        where: { clerkId: user.clerkId },
      });
      if (clash) {
        throw new ConflictException(
          `Another active user with clerkId "${user.clerkId}" already exists`,
        );
      }
    }

    await this.usersRepository.restore(id);
    await this.usersRepository.update(id, { isActive: true });
    return this.findOne(id);
  }

  /**
   * Guards against removing the system's last usable super admin. Call before
   * disabling or demoting a user that is currently an active SUPER_ADMIN.
   */
  private async assertNotLastSuperAdmin(): Promise<void> {
    const activeSuperAdmins = await this.usersRepository.count({
      where: { role: Role.SUPER_ADMIN, isActive: true },
    });
    if (activeSuperAdmins <= 1) {
      throw new ForbiddenException(
        'Cannot disable or demote the last active super admin',
      );
    }
  }

  async createOrUpdateFromClerk(
    clerkId: string,
    data: {
      email?: string;
      firstName?: string;
      lastName?: string;
      role?: Role;
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
        role: data.role ?? Role.KARDIST,
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
      user.role = data.role ?? user.role;
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
