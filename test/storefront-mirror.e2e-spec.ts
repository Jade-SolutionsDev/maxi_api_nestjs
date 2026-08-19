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
import { Role } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { configureApp } from './test-setup';

// No backoffice Clerk secret → token verification always fails, so every call
// here is a rejection. That is exactly the property under test: the endpoint
// must NOT behave differently based on whether an invitation exists.
process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_BACKOFFICE_SECRET_KEY = '';

describe('StorefrontMirrorController (e2e)', () => {
  let app: INestApplication;
  let invitationRepository: Repository<Invitation>;
  let clientRepository: Repository<Client>;

  const invitedEmail = 'invited@example.com';
  const strangerEmail = 'stranger@example.com';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    invitationRepository = moduleRef.get(getRepositoryToken(Invitation));
    clientRepository = moduleRef.get(getRepositoryToken(Client));
  });

  beforeEach(async () => {
    await invitationRepository.query(
      'TRUNCATE TABLE invitations, users, clients CASCADE',
    );
    await invitationRepository.save(
      invitationRepository.create({
        email: invitedEmail,
        role: Role.ADMIN,
        status: InvitationStatus.PENDING,
      }),
    );
  });

  afterAll(async () => {
    await invitationRepository.query(
      'TRUNCATE TABLE invitations, users, clients CASCADE',
    );
    await app.close();
  });

  const post = (email: string, auth?: string) => {
    const req = request(app.getHttpServer())
      .post('/api/users/storefront-mirror')
      .send({ email, password: 'a-strong-password' });
    return auth ? req.set('Authorization', auth) : req;
  };

  it('does not reveal whether an email was invited (no oracle)', async () => {
    // Same body and status whether or not an invitation exists for the email.
    const invited = await post(invitedEmail);
    const stranger = await post(strangerEmail);

    expect(invited.status).toBe(401);
    expect(stranger.status).toBe(invited.status);
    expect(invited.body).toEqual(stranger.body);
  });

  it('rejects a bogus bearer token and provisions nothing', async () => {
    await post(invitedEmail, 'Bearer not-a-real-token').expect(401);

    const client = await clientRepository.findOne({
      where: { email: invitedEmail },
    });
    expect(client).toBeNull();
  });
});
