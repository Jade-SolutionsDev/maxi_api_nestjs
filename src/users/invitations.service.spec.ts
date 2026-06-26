import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { Repository } from 'typeorm';
import { InviteUserDto } from './dto/invite-user.dto';
import { Invitation, InvitationStatus } from './entities/invitation.entity';
import { User, UserType } from './entities/user.entity';
import { InvitationsService } from './invitations.service';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

describe('InvitationsService', () => {
  let service: InvitationsService;
  let invitationRepository: jest.Mocked<Repository<Invitation>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;
  const createClerkClientMock = createClerkClient as jest.MockedFunction<
    typeof createClerkClient
  >;

  const inviter: User = {
    id: 'inviter-id',
    clerkId: 'clerk_inviter',
    userType: UserType.ADMIN,
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
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
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: getRepositoryToken(Invitation),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    invitationRepository = module.get(getRepositoryToken(Invitation));
    userRepository = module.get(getRepositoryToken(User));
    configService = module.get(ConfigService);

    configService.get.mockImplementation((key: string) => {
      if (key === 'clerk.backofficeSecretKey') {
        return 'sk_test_backoffice';
      }
      return undefined;
    });

    createClerkClientMock.mockReturnValue({
      invitations: {
        createInvitation: jest
          .fn()
          .mockResolvedValue({ id: 'clerk_app_invite_id' }),
      },
      organizations: {
        createOrganizationInvitation: jest
          .fn()
          .mockResolvedValue({ id: 'clerk_org_invite_id' }),
      },
    } as unknown as ReturnType<typeof createClerkClient>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAndSendInvitation', () => {
    it('should create an app-level invitation', async () => {
      userRepository.findOne.mockResolvedValue(null);
      invitationRepository.findOne.mockResolvedValue(null);
      invitationRepository.create.mockReturnValue({
        id: 'invite-id',
      } as Invitation);
      invitationRepository.save.mockResolvedValue({
        id: 'invite-id',
      } as Invitation);

      const dto: InviteUserDto = {
        email: 'new@example.com',
        userType: UserType.STAFF,
      };

      const result = await service.createAndSendInvitation(dto, inviter);

      expect(result.id).toBe('invite-id');
      expect(invitationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          userType: UserType.STAFF,
          invitedById: inviter.id,
          clerkInvitationId: 'clerk_app_invite_id',
          status: InvitationStatus.PENDING,
        }),
      );
    });

    it('should create an organization invitation when organizationId is provided', async () => {
      userRepository.findOne.mockResolvedValue(null);
      invitationRepository.findOne.mockResolvedValue(null);
      invitationRepository.create.mockReturnValue({
        id: 'invite-id',
      } as Invitation);
      invitationRepository.save.mockResolvedValue({
        id: 'invite-id',
      } as Invitation);

      const dto: InviteUserDto = {
        email: 'new@example.com',
        userType: UserType.ADMIN,
        organizationId: 'org_123',
      };

      const result = await service.createAndSendInvitation(dto, inviter);

      expect(result.id).toBe('invite-id');
      expect(invitationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          userType: UserType.ADMIN,
          organizationId: 'org_123',
          clerkInvitationId: 'clerk_org_invite_id',
        }),
      );
    });

    it('should throw ConflictException when an active user already exists', async () => {
      userRepository.findOne.mockResolvedValue(inviter);

      const dto: InviteUserDto = {
        email: inviter.email,
        userType: UserType.STAFF,
      };

      await expect(
        service.createAndSendInvitation(dto, inviter),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should throw ConflictException when a pending invitation already exists', async () => {
      userRepository.findOne.mockResolvedValue(null);
      invitationRepository.findOne.mockResolvedValue({
        id: 'existing-invite',
      } as Invitation);

      const dto: InviteUserDto = {
        email: 'new@example.com',
        userType: UserType.STAFF,
      };

      await expect(
        service.createAndSendInvitation(dto, inviter),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should throw when backoffice secret key is missing', async () => {
      configService.get.mockReturnValue(undefined);

      const dto: InviteUserDto = {
        email: 'new@example.com',
        userType: UserType.STAFF,
      };

      await expect(
        service.createAndSendInvitation(dto, inviter),
      ).rejects.toThrow('CLERK_BACKOFFICE_SECRET_KEY is not configured');
    });
  });

  describe('findPendingByEmail', () => {
    it('should return a pending invitation', async () => {
      const invitation = {
        id: 'invite-id',
        email: 'new@example.com',
        status: InvitationStatus.PENDING,
      } as Invitation;
      invitationRepository.findOne.mockResolvedValue(invitation);

      const result = await service.findPendingByEmail('NEW@example.com');

      expect(result?.email).toBe('new@example.com');
      expect(invitationRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: 'new@example.com',
            status: InvitationStatus.PENDING,
          },
          relations: { invitedBy: true },
        }),
      );
    });
  });

  describe('markAccepted', () => {
    it('should mark an invitation as accepted', async () => {
      const invitation = {
        id: 'invite-id',
        status: InvitationStatus.PENDING,
      } as Invitation;
      invitationRepository.save.mockResolvedValue(invitation);

      const result = await service.markAccepted(invitation);

      expect(result.status).toBe(InvitationStatus.ACCEPTED);
      expect(result.acceptedAt).toBeInstanceOf(Date);
    });
  });
});
