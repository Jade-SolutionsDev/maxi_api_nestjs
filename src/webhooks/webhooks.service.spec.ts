import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { ClientsService } from '../clients/clients.service';
import {
  Invitation,
  InvitationStatus,
} from '../users/entities/invitation.entity';
import { User, UserType } from '../users/entities/user.entity';
import { InvitationsService } from '../users/invitations.service';
import { UsersService } from '../users/users.service';
import { WebhooksService } from './webhooks.service';

jest.mock('@clerk/backend/webhooks', () => ({
  verifyWebhook: jest.fn(),
}));

describe('WebhooksService', () => {
  let service: WebhooksService;
  let clientsService: jest.Mocked<ClientsService>;
  let usersService: jest.Mocked<UsersService>;
  let invitationsService: jest.Mocked<InvitationsService>;
  let configService: jest.Mocked<ConfigService>;
  const verifyWebhookMock = verifyWebhook as jest.MockedFunction<
    typeof verifyWebhook
  >;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: ClientsService,
          useValue: {
            createOrUpdateFromClerk: jest.fn(),
            removeByClerkId: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            createOrUpdateFromClerk: jest.fn(),
            deactivateByClerkId: jest.fn(),
          },
        },
        {
          provide: InvitationsService,
          useValue: {
            findPendingByEmail: jest.fn(),
            markAccepted: jest.fn(),
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

    service = module.get<WebhooksService>(WebhooksService);
    clientsService = module.get(ClientsService);
    usersService = module.get(UsersService);
    invitationsService = module.get(InvitationsService);
    configService = module.get(ConfigService);

    configService.get.mockImplementation((key: string) => {
      if (key === 'clerk.webhookSecret') {
        return 'whsec_store';
      }
      if (key === 'clerk.backofficeWebhookSecret') {
        return 'whsec_admin';
      }
      if (key === 'nodeEnv') {
        return 'test';
      }
      return undefined;
    });

    verifyWebhookMock.mockRejectedValue(new Error('Payload not stubbed'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleStoreWebhook', () => {
    it('should upsert a client on user.created', async () => {
      const payload = {
        type: 'user.created',
        data: {
          id: 'client_clerk_id',
          email_addresses: [
            { id: 'email_1', email_address: 'client@example.com' },
          ],
          primary_email_address_id: 'email_1',
          first_name: 'Client',
          last_name: 'User',
        },
      };
      verifyWebhookMock.mockResolvedValueOnce(payload as never);

      const result = await service.handleStoreWebhook('raw-body', {});

      expect(result.processed).toBe(true);
      expect(clientsService.createOrUpdateFromClerk).toHaveBeenCalledWith(
        'client_clerk_id',
        {
          email: 'client@example.com',
          firstName: 'Client',
          lastName: 'User',
        },
      );
    });

    it('should delete a client on user.deleted', async () => {
      const payload = {
        type: 'user.deleted',
        data: { id: 'client_clerk_id' },
      };
      verifyWebhookMock.mockResolvedValueOnce(payload as never);

      const result = await service.handleStoreWebhook('raw-body', {});

      expect(result.processed).toBe(true);
      expect(clientsService.removeByClerkId).toHaveBeenCalledWith(
        'client_clerk_id',
      );
    });

    it('should reject an unverified webhook in production', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'clerk.webhookSecret') {
          return undefined;
        }
        if (key === 'nodeEnv') {
          return 'production';
        }
        return undefined;
      });

      await expect(
        service.handleStoreWebhook('raw-body', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('handleAdminWebhook', () => {
    const invitation: Invitation = {
      id: 'invite-id',
      email: 'admin@example.com',
      userType: UserType.ADMIN,
      invitedById: null,
      invitedBy: null,
      organizationId: null,
      clerkInvitationId: null,
      status: InvitationStatus.PENDING,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should create an admin user from a pending invitation on user.created', async () => {
      const payload = {
        type: 'user.created',
        data: {
          id: 'admin_clerk_id',
          email_addresses: [
            { id: 'email_1', email_address: 'admin@example.com' },
          ],
          primary_email_address_id: 'email_1',
          first_name: 'Admin',
          last_name: 'User',
        },
      };
      verifyWebhookMock.mockResolvedValueOnce(payload as never);
      invitationsService.findPendingByEmail.mockResolvedValue(invitation);
      invitationsService.markAccepted.mockResolvedValue({
        ...invitation,
        status: InvitationStatus.ACCEPTED,
      });
      usersService.createOrUpdateFromClerk.mockResolvedValue({
        id: 'user-id',
      } as User);

      const result = await service.handleAdminWebhook('raw-body', {});

      expect(result.processed).toBe(true);
      expect(usersService.createOrUpdateFromClerk).toHaveBeenCalledWith(
        'admin_clerk_id',
        {
          email: 'admin@example.com',
          firstName: 'Admin',
          lastName: 'User',
          userType: UserType.ADMIN,
        },
      );
      expect(invitationsService.markAccepted).toHaveBeenCalledWith(invitation);
    });

    it('should skip admin user creation when no pending invitation exists', async () => {
      const payload = {
        type: 'user.created',
        data: {
          id: 'admin_clerk_id',
          email_addresses: [
            { id: 'email_1', email_address: 'unknown@example.com' },
          ],
          primary_email_address_id: 'email_1',
        },
      };
      verifyWebhookMock.mockResolvedValueOnce(payload as never);
      invitationsService.findPendingByEmail.mockResolvedValue(null);

      const result = await service.handleAdminWebhook('raw-body', {});

      expect(result.processed).toBe(true);
      expect(usersService.createOrUpdateFromClerk).not.toHaveBeenCalled();
      expect(invitationsService.markAccepted).not.toHaveBeenCalled();
    });

    it('should update an admin user on user.updated', async () => {
      const payload = {
        type: 'user.updated',
        data: {
          id: 'admin_clerk_id',
          email_addresses: [
            { id: 'email_1', email_address: 'updated@example.com' },
          ],
          primary_email_address_id: 'email_1',
          first_name: 'Updated',
          last_name: 'Name',
        },
      };
      verifyWebhookMock.mockResolvedValueOnce(payload as never);
      usersService.createOrUpdateFromClerk.mockResolvedValue({
        id: 'user-id',
      } as User);

      const result = await service.handleAdminWebhook('raw-body', {});

      expect(result.processed).toBe(true);
      expect(usersService.createOrUpdateFromClerk).toHaveBeenCalledWith(
        'admin_clerk_id',
        {
          email: 'updated@example.com',
          firstName: 'Updated',
          lastName: 'Name',
          userType: undefined,
        },
      );
    });

    it('should deactivate a user on user.deleted', async () => {
      const payload = {
        type: 'user.deleted',
        data: { id: 'admin_clerk_id' },
      };
      verifyWebhookMock.mockResolvedValueOnce(payload as never);

      const result = await service.handleAdminWebhook('raw-body', {});

      expect(result.processed).toBe(true);
      expect(usersService.deactivateByClerkId).toHaveBeenCalledWith(
        'admin_clerk_id',
      );
    });

    it('should reject invalid JSON in dev mode when no secret is set', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'clerk.backofficeWebhookSecret') {
          return undefined;
        }
        if (key === 'nodeEnv') {
          return 'development';
        }
        return undefined;
      });

      await expect(
        service.handleAdminWebhook('not-json', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
