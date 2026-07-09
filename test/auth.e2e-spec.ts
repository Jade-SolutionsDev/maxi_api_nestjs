import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from './test-setup';
import { Role, User } from '../src/users/entities/user.entity';

process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_BACKOFFICE_SECRET_KEY = '';
process.env.CLERK_JWT_SECRET = 'dev-secret';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let repository: Repository<User>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    repository = moduleRef.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    await repository.query('TRUNCATE TABLE invitations, users CASCADE');
  });

  afterAll(async () => {
    await repository.query('TRUNCATE TABLE invitations, users CASCADE');
    await app.close();
  });

  it('should return the current backoffice user', async () => {
    const clerkId = 'clerk_user_1';
    await repository.save(
      repository.create({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        role: Role.ADMIN,
        isActive: true,
        clerkId,
      }),
    );

    const token = sign({ sub: clerkId }, 'dev-secret');

    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.email).toBe('jane@example.com');
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('should reject an invalid token', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });
});
