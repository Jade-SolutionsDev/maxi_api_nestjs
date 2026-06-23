import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/helpers/password.helper';
import { configureApp } from './test-setup';
import { User, UserStatus, UserType } from '../src/users/entities/user.entity';

describe('AuthController (e2e)', () => {
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

  it('should return a token for valid credentials', async () => {
    const password = 'SecurePass1';
    await repository.save(
      repository.create({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        userType: UserType.ADMIN,
        status: UserStatus.ACTIVE,
        passwordHash: await hashPassword(password),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'jane@example.com', password })
      .expect(200);

    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user.email).toBe('jane@example.com');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('should reject invalid credentials', async () => {
    const password = 'SecurePass1';
    await repository.save(
      repository.create({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        userType: UserType.ADMIN,
        status: UserStatus.ACTIVE,
        passwordHash: await hashPassword(password),
      }),
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'jane@example.com', password: 'WrongPassword' })
      .expect(401);
  });
});
