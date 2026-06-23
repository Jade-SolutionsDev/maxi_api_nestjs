import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

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

  it('should create and manage users', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/users')
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        userType: 'admin',
        status: 'active',
        password: 'SecurePass1',
      })
      .expect(201);

    expect(createResponse.body.data).toHaveProperty('id');
    expect(createResponse.body.data.email).toBe('jane@example.com');
    expect(createResponse.body.data).not.toHaveProperty('passwordHash');
    const userId = createResponse.body.data.id;

    const listResponse = await request(app.getHttpServer())
      .get('/users')
      .expect(200);
    expect(listResponse.body.data).toHaveLength(1);

    const getResponse = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .expect(200);
    expect(getResponse.body.data.id).toBe(userId);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .send({ firstName: 'Janet' })
      .expect(200);
    expect(updateResponse.body.data.firstName).toBe('Janet');

    await request(app.getHttpServer()).delete(`/users/${userId}`).expect(200);

    await request(app.getHttpServer()).get(`/users/${userId}`).expect(404);
  });
});
