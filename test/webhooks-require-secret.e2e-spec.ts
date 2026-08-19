import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

// A deployed environment must verify webhook signatures. With no secret AND the
// escape hatch NOT set, the webhook must be rejected — not silently trusted.
process.env.CLERK_WEBHOOK_SECRET = '';
process.env.CLERK_BACKOFFICE_WEBHOOK_SECRET = '';
delete process.env.ALLOW_UNVERIFIED_WEBHOOKS;

describe('WebhooksController signature enforcement (e2e)', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    userRepository = moduleRef.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE invitations, users, clients CASCADE',
    );
    await app.close();
  });

  it('rejects a webhook when no secret is configured and unsigned is not allowed', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'clerk_spoof_1',
        email_addresses: [{ id: 'e1', email_address: 'spoof@example.com' }],
        primary_email_address_id: 'e1',
      },
    };

    await request(app.getHttpServer())
      .post('/api/webhooks/clerk/admin')
      .send(payload)
      .expect(401);

    const user = await userRepository.findOne({
      where: { clerkId: 'clerk_spoof_1' },
    });
    expect(user).toBeNull();
  });
});
