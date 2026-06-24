import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User, UserType } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_BACKOFFICE_SECRET_KEY = '';
process.env.CLERK_JWT_SECRET = 'dev-secret';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let repository: Repository<User>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    repository = moduleRef.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    await repository.clear();
  });

  afterAll(async () => {
    await repository.clear();
    await app.close();
  });

  const createAdminToken = async (): Promise<string> => {
    const admin = await repository.save(
      repository.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@example.com',
        userType: UserType.ADMIN,
        isActive: true,
        clerkId: 'clerk_admin_1',
      }),
    );
    return sign({ sub: admin.clerkId }, 'dev-secret');
  };

  it('should reject unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);
  });

  it('should reject non-admin requests', async () => {
    const provider = await repository.save(
      repository.create({
        firstName: 'Provider',
        lastName: 'User',
        email: 'provider@example.com',
        userType: UserType.PROVIDER,
        isActive: true,
        clerkId: 'clerk_provider_1',
      }),
    );
    const token = sign({ sub: provider.clerkId }, 'dev-secret');

    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('should create and manage users for admin users', async () => {
    const token = await createAdminToken();

    const createResponse = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        userType: 'admin',
      })
      .expect(201);

    expect(createResponse.body.data).toHaveProperty('id');
    expect(createResponse.body.data.email).toBe('jane@example.com');
    expect(createResponse.body.data).not.toHaveProperty('passwordHash');
    const userId = createResponse.body.data.id;

    const listResponse = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listResponse.body.data).toHaveLength(2);

    const getResponse = await request(app.getHttpServer())
      .get(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getResponse.body.data.id).toBe(userId);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Janet' })
      .expect(200);
    expect(updateResponse.body.data.firstName).toBe('Janet');

    await request(app.getHttpServer())
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
