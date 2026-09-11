import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { Repository } from 'typeorm';
import { PermissionsService } from '../permissions/permissions.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { Invitation, InvitationStatus } from './entities/invitation.entity';
import { Role, User } from './entities/user.entity';
import { InvitationsService } from './invitations.service';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

describe('InvitationsService', () => {
  let service: InvitationsService;
  let invitationRepository: jest.Mocked<Repository<Invitation>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;
  let revokeInvitation: jest.Mock;
  let permissionsService: { assertActiveRoles: jest.Mock };
  const createClerkClientMock = createClerkClient as jest.MockedFunction<
    typeof createClerkClient
  >;

  const inviter: User = {
    id: 'inviter-id',
    clerkId: 'clerk_inviter',
    role: Role.ADMIN,
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
    permissionsService = { assertActiveRoles: jest.fn() };
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
        {
          provide: PermissionsService,
          useValue: permissionsService,
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

    revokeInvitation = jest.fn().mockResolvedValue({ id: 'revoked' });
    createClerkClientMock.mockReturnValue({
      invitations: {
        createInvitation: jest
          .fn()
          .mockResolvedValue({ id: 'clerk_app_invite_id' }),
        revokeInvitation,
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
        role: Role.STAFF,
      };

      const result = await service.createAndSendInvitation(dto, inviter);

      expect(result.id).toBe('invite-id');
      expect(invitationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          role: Role.STAFF,
          invitedById: inviter.id,
          clerkInvitationId: 'clerk_app_invite_id',
          status: InvitationStatus.PENDING,
        }),
      );
    });

    it('stores the invited managed roles after validating them', async () => {
      userRepository.findOne.mockResolvedValue(null);
      invitationRepository.findOne.mockResolvedValue(null);
      invitationRepository.create.mockReturnValue({
        id: 'invite-id',
      } as Invitation);
      invitationRepository.save.mockResolvedValue({
        id: 'invite-id',
      } as Invitation);

      await service.createAndSendInvitation(
        {
          email: 'new@example.com',
          role: Role.STAFF,
          roleIds: ['r1', 'r2', 'r1'], // dupes collapse
        },
        inviter,
      );

      expect(permissionsService.assertActiveRoles).toHaveBeenCalledWith([
        'r1',
        'r2',
      ]);
      expect(invitationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleIds: ['r1', 'r2'] }),
      );
    });

    it('rejects managed roles on an admin-tier invitation', async () => {
      await expect(
        service.createAndSendInvitation(
          { email: 'new@example.com', role: Role.ADMIN, roleIds: ['r1'] },
          inviter,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invitationRepository.save).not.toHaveBeenCalled();
    });

    it('propagates unknown role ids from validation', async () => {
      permissionsService.assertActiveRoles.mockRejectedValue(
        new NotFoundException('One or more roles were not found'),
      );
      await expect(
        service.createAndSendInvitation(
          { email: 'new@example.com', role: Role.STAFF, roleIds: ['nope'] },
          inviter,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
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
        role: Role.ADMIN,
        organizationId: 'org_123',
      };

      const result = await service.createAndSendInvitation(dto, inviter);

      expect(result.id).toBe('invite-id');
      expect(invitationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          role: Role.ADMIN,
          organizationId: 'org_123',
          clerkInvitationId: 'clerk_org_invite_id',
        }),
      );
    });

    it('should throw ConflictException when an active user already exists', async () => {
      userRepository.findOne.mockResolvedValue(inviter);

      const dto: InviteUserDto = {
        email: inviter.email!,
        role: Role.STAFF,
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
        role: Role.STAFF,
      };

      await expect(
        service.createAndSendInvitation(dto, inviter),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should throw when backoffice secret key is missing', async () => {
      configService.get.mockReturnValue(undefined);

      const dto: InviteUserDto = {
        email: 'new@example.com',
        role: Role.STAFF,
      };

      await expect(
        service.createAndSendInvitation(dto, inviter),
      ).rejects.toThrow('CLERK_BACKOFFICE_SECRET_KEY is not configured');
    });
  });

  describe('revoke', () => {
    it('should revoke a pending invitation and mark it REVOKED', async () => {
      const invitation = {
        id: 'invite-id',
        status: InvitationStatus.PENDING,
        clerkInvitationId: 'clerk_app_invite_id',
      } as Invitation;
      invitationRepository.findOne.mockResolvedValue(invitation);
      invitationRepository.save.mockImplementation((i) =>
        Promise.resolve(i as Invitation),
      );

      const result = await service.revoke('invite-id');

      expect(result.status).toBe(InvitationStatus.REVOKED);
      expect(revokeInvitation).toHaveBeenCalledWith('clerk_app_invite_id');
    });

    it('should be idempotent for an already-revoked invitation', async () => {
      const invitation = {
        id: 'invite-id',
        status: InvitationStatus.REVOKED,
        clerkInvitationId: 'clerk_app_invite_id',
      } as Invitation;
      invitationRepository.findOne.mockResolvedValue(invitation);

      const result = await service.revoke('invite-id');

      expect(result.status).toBe(InvitationStatus.REVOKED);
      expect(revokeInvitation).not.toHaveBeenCalled();
    });

    it('should reject revoking an accepted invitation', async () => {
      const invitation = {
        id: 'invite-id',
        status: InvitationStatus.ACCEPTED,
      } as Invitation;
      invitationRepository.findOne.mockResolvedValue(invitation);

      await expect(service.revoke('invite-id')).rejects.toBeInstanceOf(
        ConflictException,
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
