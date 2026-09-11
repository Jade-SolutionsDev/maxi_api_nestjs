import { sinTildes } from '../common/search/accent-insensitive';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { IsNull, Repository } from 'typeorm';
import { CustomerProvisioningService } from '../clients/customer-provisioning.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  buildPaginatedResponse,
  getPaginationParams,
  PaginatedResponse,
  PaginationQueryDto,
} from '../common/dto/pagination.dto';
import { CreateUserDto } from './dto/create-user.dto';
import type { UserStatusFilter } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role, User } from './entities/user.entity';
import { Invitation, InvitationStatus } from './entities/invitation.entity';

export interface FindUsersFilter {
  q?: string;
  /** Access tier (Role value) OR a managed-role uuid — one overloaded param. */
  role?: string;
  status?: UserStatusFilter;
  includeInvitations?: boolean;
  includeDeleted?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Invitation)
    private readonly invitationRepository: Repository<Invitation>,
    private readonly configService: ConfigService,
    private readonly customerProvisioning: CustomerProvisioningService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /** Run a side effect (storefront mirror, base-role assignment) without ever
   *  failing the admin action it rides on. */
  private async safeMirror(
    fn: () => Promise<void>,
    context: string,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`Side effect (${context}) failed: ${String(err)}`);
    }
  }

  async findAll(
    filter: FindUsersFilter = {},
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResponse<User>> {
    const { page, limit, skip } = getPaginationParams(pagination);

    // The "Rol" filter is one param carrying either an access tier or a
    // managed-role uuid (the list UI mixes both in one dropdown).
    const tierFilter = Object.values(Role).includes(filter.role as Role)
      ? (filter.role as Role)
      : undefined;
    const managedRoleFilter =
      !tierFilter && filter.role && UUID_RE.test(filter.role)
        ? filter.role
        : undefined;
    if (filter.role && !tierFilter && !managedRoleFilter) {
      throw new BadRequestException(`Unknown role filter "${filter.role}"`);
    }

    // "Pending" (the "Awaiting approval" tab) combines two not-yet-usable
    // states: pending invitations (not registered) and registered users that
    // haven't been approved yet (isActive=false, never approved).
    if (filter.status === 'pending') {
      const [invitations, awaiting] = await Promise.all([
        this.loadPendingInvitationUsers(),
        this.usersRepository.find({
          where: { isActive: false, approvedAt: IsNull() },
          order: { createdAt: 'DESC', id: 'DESC' },
        }),
      ]);
      const combined = [...invitations, ...awaiting].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      const pageItems = combined.slice(skip, skip + limit);
      await this.attachManagedRoles(
        pageItems.filter((u) => u.managedRoles === undefined),
      );
      return buildPaginatedResponse(pageItems, combined.length, page, limit);
    }

    const qb = this.usersRepository.createQueryBuilder('user');
    // Soft-deleted users are hidden unless the caller opts in.
    if (filter.includeDeleted) {
      qb.withDeleted();
    }
    if (filter.q) {
      qb.andWhere(
        `(${sinTildes('user.firstName')} OR ${sinTildes('user.lastName')} OR ${sinTildes('user.email')} OR ${sinTildes('user.phone')} OR ${sinTildes('user.businessName')})`,
        { q: `%${filter.q}%` },
      );
    }
    if (tierFilter) {
      qb.andWhere('user.role = :role', { role: tierFilter });
    }
    if (managedRoleFilter) {
      qb.innerJoin(
        'user_roles',
        'ur',
        'ur.user_id = user.id AND ur.role_id = :managedRoleId',
        { managedRoleId: managedRoleFilter },
      );
    }
    if (filter.status === 'active') {
      qb.andWhere('user.isActive = true');
    } else if (filter.status === 'inactive') {
      // Admin-disabled only — awaiting-approval accounts live in the "pending"
      // facet, not here.
      qb.andWhere('user.isActive = false').andWhere(
        'user.approvedAt IS NOT NULL',
      );
    } else if (filter.status === 'awaiting_approval') {
      // Registered users that still need approval (drives the tab count badge).
      qb.andWhere('user.isActive = false').andWhere('user.approvedAt IS NULL');
    } else if (!filter.includeDeleted) {
      // Default "all" view hides awaiting-approval users — they belong only in
      // the "Awaiting approval" tab. (The show-deleted view opts out so a
      // mistakenly rejected user can still be found and restored.)
      qb.andWhere('(user.isActive = true OR user.approvedAt IS NOT NULL)');
    }
    // id is a unique PK — a deterministic tiebreaker so rows keep a stable
    // total order across refetches (createdAt alone ties on same-instant seeds).
    qb.orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [users, usersTotal] = await qb.getManyAndCount();

    let items = users;
    let total = usersTotal;

    // Only the unfiltered ("all") view mixes in pending invitations, pinned to
    // the first page. Status facets are exclusive. The role filter applies to
    // invitations too — by tier, or by invited managed role.
    if (!filter.status && filter.includeInvitations) {
      let pendingUsers = await this.loadPendingInvitationUsers();
      if (tierFilter) {
        pendingUsers = pendingUsers.filter((u) => u.role === tierFilter);
      }
      if (managedRoleFilter) {
        pendingUsers = pendingUsers.filter((u) =>
          u.managedRoles?.some((r) => r.id === managedRoleFilter),
        );
      }
      total += pendingUsers.length;
      if (page === 1) {
        items = [...pendingUsers, ...users];
      }
    }

    await this.attachManagedRoles(
      items.filter((u) => u.managedRoles === undefined),
    );
    return buildPaginatedResponse(items, total, page, limit);
  }

  /** One batched query: attach active managed roles to the given users. */
  private async attachManagedRoles(users: User[]): Promise<void> {
    if (users.length === 0) return;
    const byUser = await this.permissionsService.getRolesByUserIds(
      users.map((u) => u.id),
    );
    for (const user of users) {
      user.managedRoles = byUser[user.id] ?? [];
    }
  }

  private async loadPendingInvitationUsers(): Promise<User[]> {
    const invitations = await this.invitationRepository.find({
      where: { status: InvitationStatus.PENDING },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    // Resolve the invited managed roles in one batch so the list can show
    // what the person was invited AS (their fake ids have no user_roles).
    const summaries = await this.permissionsService.getRoleSummariesByIds(
      invitations.flatMap((i) => i.roleIds ?? []),
    );
    const roleById = new Map(summaries.map((r) => [r.id, r]));

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
      user.deletedAt = null;
      user.createdBy = invitation.invitedById;
      user.createdAt = invitation.createdAt;
      user.updatedAt = invitation.updatedAt;
      user.managedRoles = (invitation.roleIds ?? [])
        .map((id) => roleById.get(id))
        .filter((r): r is { id: string; name: string } => Boolean(r));
      return user;
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    await this.attachManagedRoles([user]);
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

    // Roles are assigned explicitly (invitation roleIds via the webhook, or
    // an admin through PUT /permissions/users/:id/roles) — nothing automatic.
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

    this.usersRepository.merge(user, updateUserDto);
    if (updateUserDto.email) {
      const email = updateUserDto.email.toLowerCase();
      await this.guardDuplicateEmail(email, id);
      user.email = email;
    }

    // First activation doubles as approval — stamp it so an awaiting-approval
    // account (never approved) stays distinguishable from an admin-disabled one.
    const justApproved = user.isActive && !user.approvedAt;
    if (justApproved) {
      user.approvedAt = new Date();
    }

    const saved = await this.usersRepository.save(user);

    // On approval, enable the storefront customer we mirrored at sign-up so the
    // admin can also shop with the same credentials.
    if (justApproved) {
      await this.safeMirror(
        () => this.customerProvisioning.activateForEmail(saved.email),
        `activate ${saved.email ?? ''}`,
      );
    }

    return saved;
  }

  /**
   * Admin-set a user's Clerk password. Own password is intentionally rejected —
   * a user changes their own password through the profile/Clerk flow, not here.
   */
  async setPassword(id: string, password: string, actor?: User): Promise<void> {
    if (actor?.id === id) {
      throw new ForbiddenException(
        'Change your own password from your profile, not the user list',
      );
    }

    const user = await this.findOne(id);
    if (!user.clerkId) {
      throw new BadRequestException(
        'User has no Clerk account yet (pending invitation)',
      );
    }

    const secretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );
    if (!secretKey) {
      throw new Error('CLERK_BACKOFFICE_SECRET_KEY is not configured');
    }

    const clerkClient = createClerkClient({ secretKey });
    await clerkClient.users.updateUser(user.clerkId, {
      password,
      // Force other devices to re-authenticate with the new password.
      signOutOfOtherSessions: true,
    });
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

    // Deleting a never-approved user is a rejection — tear down the gated
    // storefront customer we provisioned at sign-up. Approved users keep theirs.
    if (!user.approvedAt) {
      await this.safeMirror(
        () => this.customerProvisioning.revokeForEmail(user.email),
        `revoke ${user.email ?? ''}`,
      );
    }
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
      /** Managed roles from the invitation, assigned on first creation. */
      roleIds?: string[];
      phone?: string;
      businessName?: string;
    },
  ): Promise<User> {
    let user = await this.usersRepository.findOne({
      where: { clerkId },
      withDeleted: true,
    });
    const isNew = !user;

    if (!user) {
      if (data.email) {
        await this.guardDuplicateEmail(data.email.toLowerCase());
      }
      // Invited users register into a DISABLED state and cannot access the app
      // until an ADMIN/SUPER_ADMIN approves them (auth.service rejects inactive
      // accounts). approvedAt stays null → "awaiting approval".
      user = this.usersRepository.create({
        clerkId,
        email: data.email?.toLowerCase() ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phone: data.phone ?? null,
        businessName: data.businessName ?? null,
        role: data.role ?? Role.STAFF,
        isActive: false,
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
      // Profile updates from Clerk must NOT change activation — approval is an
      // explicit admin action, and a disabled account stays disabled.
    }

    const saved = await this.usersRepository.save(user);
    if (isNew) {
      // The invitation chose the managed roles; assign them leniently (a role
      // deleted since the invite is skipped, and this never fails creation).
      await this.safeMirror(
        () =>
          this.permissionsService.assignRolesLenient(
            saved.id,
            data.roleIds ?? [],
          ),
        `assign invited roles`,
      );
    }
    return saved;
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
