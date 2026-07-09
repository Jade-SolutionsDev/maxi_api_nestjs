import { Test, TestingModule } from '@nestjs/testing';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Invitation, InvitationStatus } from './entities/invitation.entity';
import { Role, User } from './entities/user.entity';
import { InvitationsService } from './invitations.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<UsersService>;
  let invitationsService: jest.Mocked<InvitationsService>;

  const user: UserResponseDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkId: 'clerk_user_1',
    role: Role.ADMIN,
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    businessName: null,
    businessDescription: null,
    businessLogoUrl: null,
    clerkOrgId: null,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const actor = { ...user, deletedAt: null } as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            findByClerkId: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            restore: jest.fn(),
          },
        },
        {
          provide: InvitationsService,
          useValue: {
            createAndSendInvitation: jest.fn(),
            revoke: jest.fn(),
            resend: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get(UsersService);
    invitationsService = module.get(InvitationsService);
  });

  it('should list users (paginated)', async () => {
    service.findAll.mockResolvedValue({
      data: [user],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    } as unknown as never);
    const result = await controller.findAll({});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe(user.email);
    expect(result.meta.total).toBe(1);
  });

  it('should get a user by id', async () => {
    service.findOne.mockResolvedValue(user as unknown as never);
    const result = await controller.findOne(user.id);
    expect(result.id).toBe(user.id);
  });

  it('should lookup a user by clerkId', async () => {
    service.findByClerkId.mockResolvedValue(user as unknown as never);
    const result = await controller.findByClerkId(user.clerkId!);
    expect(result?.clerkId).toBe(user.clerkId);
  });

  it('should create a user', async () => {
    const createDto: CreateUserDto = {
      clerkId: 'clerk_user_2',
      email: 'jane@example.com',
      role: Role.ADMIN,
    };
    service.create.mockResolvedValue(user as unknown as never);
    const result = await controller.create(createDto);
    expect(result.email).toBe(createDto.email);
  });

  it('should update a user, forwarding the acting user', async () => {
    const updateDto: UpdateUserDto = { firstName: 'Janet' };
    service.update.mockResolvedValue({
      ...user,
      firstName: 'Janet',
    } as unknown as never);
    const result = await controller.update(user.id, updateDto, actor);
    expect(result.firstName).toBe('Janet');
    expect(service.update).toHaveBeenCalledWith(user.id, updateDto, actor);
  });

  it('should remove a user, forwarding the acting user', async () => {
    service.remove.mockResolvedValue(undefined);
    await controller.remove(user.id, actor);
    expect(service.remove).toHaveBeenCalledWith(user.id, actor);
  });

  it('should restore a user', async () => {
    service.restore.mockResolvedValue(user as unknown as never);
    const result = await controller.restore(user.id);
    expect(result.id).toBe(user.id);
    expect(service.restore).toHaveBeenCalledWith(user.id);
  });

  it('should invite a user and return a response dto', async () => {
    const dto: InviteUserDto = {
      email: 'invite@example.com',
      role: Role.KARDIST,
    };
    const invitation: Invitation = {
      id: 'invite-id',
      email: dto.email,
      role: dto.role,
      invitedById: actor.id,
      invitedBy: actor,
      organizationId: null,
      firstName: null,
      lastName: null,
      clerkInvitationId: 'clerk_inv_1',
      status: InvitationStatus.PENDING,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    invitationsService.createAndSendInvitation.mockResolvedValue(invitation);

    const result = await controller.invite(dto, actor);

    expect(result.email).toBe(dto.email);
    expect(result.status).toBe(InvitationStatus.PENDING);
    expect(invitationsService.createAndSendInvitation).toHaveBeenCalledWith(
      dto,
      actor,
    );
  });

  it('should revoke an invitation', async () => {
    const invitation = {
      id: 'invite-id',
      email: 'invite@example.com',
      role: Role.KARDIST,
      status: InvitationStatus.REVOKED,
      invitedById: null,
      organizationId: null,
      firstName: null,
      lastName: null,
      clerkInvitationId: null,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Invitation;
    invitationsService.revoke.mockResolvedValue(invitation);
    const result = await controller.revokeInvitation('invite-id');
    expect(result.status).toBe(InvitationStatus.REVOKED);
    expect(invitationsService.revoke).toHaveBeenCalledWith('invite-id');
  });
});
