import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  Invitation,
  InvitationStatus,
} from '../src/users/entities/invitation.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.CLERK_WEBHOOK_SECRET = '';
process.env.CLERK_BACKOFFICE_WEBHOOK_SECRET = '';
process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_BACKOFFICE_SECRET_KEY = '';

describe('WebhooksController (e2e)', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let invitationRepository: Repository<Invitation>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    userRepository = moduleRef.get(getRepositoryToken(User));
    invitationRepository = moduleRef.get(getRepositoryToken(Invitation));
  });

  beforeEach(async () => {
    await userRepository.query(
      'TRUNCATE TABLE invitations, users, clients CASCADE',
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE invitations, users, clients CASCADE',
    );
    await app.close();
  });

  it('should process a storefront user.created webhook', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'clerk_client_1',
        email_addresses: [
          { id: 'email_1', email_address: 'client@example.com' },
        ],
        primary_email_address_id: 'email_1',
        first_name: 'Client',
        last_name: 'User',
      },
    };

    await request(app.getHttpServer())
      .post('/api/webhooks/clerk/store')
      .send(payload)
      .expect(200)
      .expect({ data: { processed: true } });

    const client = await userRepository.query(
      'SELECT * FROM clients WHERE clerk_id = $1',
      ['clerk_client_1'],
    );
    expect(client).toHaveLength(1);
    expect(client[0].email).toBe('client@example.com');
  });

  it('should process a backoffice user.created webhook when a pending invitation exists', async () => {
    await invitationRepository.save(
      invitationRepository.create({
        email: 'admin@example.com',
        role: Role.ADMIN,
        status: InvitationStatus.PENDING,
      }),
    );

    const payload = {
      type: 'user.created',
      data: {
        id: 'clerk_admin_1',
        email_addresses: [
          { id: 'email_1', email_address: 'admin@example.com' },
        ],
        primary_email_address_id: 'email_1',
        first_name: 'Admin',
        last_name: 'User',
      },
    };

    await request(app.getHttpServer())
      .post('/api/webhooks/clerk/admin')
      .send(payload)
      .expect(200)
      .expect({ data: { processed: true } });

    const user = await userRepository.findOne({
      where: { clerkId: 'clerk_admin_1' },
    });
    expect(user).toBeDefined();
    expect(user?.email).toBe('admin@example.com');
    expect(user?.role).toBe(Role.ADMIN);

    const invitation = await invitationRepository.findOne({
      where: { email: 'admin@example.com' },
    });
    expect(invitation?.status).toBe(InvitationStatus.ACCEPTED);
  });

  it('should skip admin user creation when no pending invitation exists', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'clerk_admin_2',
        email_addresses: [
          { id: 'email_1', email_address: 'unknown@example.com' },
        ],
        primary_email_address_id: 'email_1',
      },
    };

    await request(app.getHttpServer())
      .post('/api/webhooks/clerk/admin')
      .send(payload)
      .expect(200)
      .expect({ data: { processed: true } });

    const user = await userRepository.findOne({
      where: { clerkId: 'clerk_admin_2' },
    });
    expect(user).toBeNull();
  });
});
