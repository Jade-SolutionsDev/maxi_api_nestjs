import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { CustomerProvisioningService } from './customer-provisioning.service';
import { Client } from './entities/client.entity';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

describe('CustomerProvisioningService', () => {
  let service: CustomerProvisioningService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let clerkUsers: {
    getUserList: jest.Mock;
    createUser: jest.Mock;
    deleteUser: jest.Mock;
    updateUserMetadata: jest.Mock;
  };
  const createClerkClientMock = createClerkClient as jest.MockedFunction<
    typeof createClerkClient
  >;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((v: Partial<Client>) => v),
      save: jest.fn((v: Partial<Client>) => Promise.resolve(v)),
      softDelete: jest.fn(),
    };
    clerkUsers = {
      getUserList: jest.fn(),
      createUser: jest.fn(),
      deleteUser: jest.fn().mockResolvedValue({}),
      updateUserMetadata: jest.fn().mockResolvedValue({}),
    };
    createClerkClientMock.mockReturnValue({
      users: clerkUsers,
    } as unknown as ReturnType<typeof createClerkClient>);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerProvisioningService,
        { provide: getRepositoryToken(Client), useValue: repo },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'sk_test') } },
      ],
    }).compile();

    service = module.get(CustomerProvisioningService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('provisionPending', () => {
    it('leaves a pre-existing storefront customer untouched', async () => {
      clerkUsers.getUserList.mockResolvedValue({ data: [{ id: 'u1' }] });

      await service.provisionPending({ email: 'A@x.com', password: 'pw' });

      expect(clerkUsers.createUser).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('creates a Clerk user + gated client when none exists', async () => {
      clerkUsers.getUserList.mockResolvedValue({ data: [] });
      clerkUsers.createUser.mockResolvedValue({ id: 'cust_1' });
      repo.findOne.mockResolvedValue(null);

      await service.provisionPending({
        email: 'New@x.com',
        password: 'secret12',
        firstName: 'New',
      });

      expect(clerkUsers.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: ['new@x.com'],
          password: 'secret12',
          skipPasswordChecks: true,
        }),
      );
      const saved = repo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        clerkId: 'cust_1',
        email: 'new@x.com',
        isActive: false,
        adminInvitePending: true,
      });
    });
  });

  describe('activateForEmail', () => {
    it('enables a gated invite customer', async () => {
      repo.findOne.mockResolvedValue({
        id: 'c1',
        clerkId: 'cust_1',
        isActive: false,
        adminInvitePending: true,
      });

      await service.activateForEmail('a@x.com');

      const saved = repo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        isActive: true,
        adminInvitePending: false,
      });
      expect(clerkUsers.updateUserMetadata).toHaveBeenCalled();
    });

    it('ignores a real (non-pending) customer', async () => {
      repo.findOne.mockResolvedValue({ id: 'c1', adminInvitePending: false });
      await service.activateForEmail('a@x.com');
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeForEmail', () => {
    it('deletes the Clerk user and soft-deletes a gated invite customer', async () => {
      repo.findOne.mockResolvedValue({
        id: 'c1',
        clerkId: 'cust_1',
        adminInvitePending: true,
      });

      await service.revokeForEmail('a@x.com');

      expect(clerkUsers.deleteUser).toHaveBeenCalledWith('cust_1');
      expect(repo.softDelete).toHaveBeenCalledWith('c1');
    });

    it('never touches a real customer', async () => {
      repo.findOne.mockResolvedValue({ id: 'c1', adminInvitePending: false });
      await service.revokeForEmail('a@x.com');
      expect(clerkUsers.deleteUser).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
