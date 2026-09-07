import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Permission } from '../src/permissions/entities/permission.entity';
import { ManagedRole } from '../src/permissions/entities/role.entity';
import { RolePermission } from '../src/permissions/entities/role-permission.entity';
import { UserRole } from '../src/permissions/entities/user-role.entity';
import { MODULE_ACTIONS } from '../src/permissions/permissions.service';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.MOCK_AUTH_ENABLED = 'true';

/**
 * Default-deny RBAC, end to end. NB: e2e users are inserted post-boot via the
 * repository, so the boot seeder never auto-assigns them — grants here go in
 * as explicit user_roles rows, which is exactly what the Roles UI produces.
 */
describe('RBAC default-deny (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let roles: Repository<ManagedRole>;
  let permissions: Repository<Permission>;
  let rolePermissions: Repository<RolePermission>;
  let userRoles: Repository<UserRole>;
  let customRoleId: string;

  const adminAuth = { Authorization: 'Bearer mock:clerk_rbac_admin' };
  const kardistAuth = { Authorization: 'Bearer mock:clerk_rbac_kardist' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    users = moduleRef.get(getRepositoryToken(User));
    roles = moduleRef.get(getRepositoryToken(ManagedRole));
    permissions = moduleRef.get(getRepositoryToken(Permission));
    rolePermissions = moduleRef.get(getRepositoryToken(RolePermission));
    userRoles = moduleRef.get(getRepositoryToken(UserRole));

    await users.query('TRUNCATE TABLE users CASCADE');
    await users.save(
      users.create({
        clerkId: 'clerk_rbac_admin',
        email: 'rbac-admin@example.com',
        role: Role.ADMIN,
        isActive: true,
      }),
    );
    await users.save(
      users.create({
        clerkId: 'clerk_rbac_kardist',
        email: 'rbac-kardist@example.com',
        role: Role.KARDIST,
        isActive: true,
      }),
    );
  });

  afterAll(async () => {
    // Hard-delete the custom role and its rows so repeat runs start clean.
    if (customRoleId) {
      await userRoles.delete({ roleId: customRoleId });
      await rolePermissions.delete({ roleId: customRoleId });
      await roles.delete(customRoleId);
    }
    await app.close();
  });

  it('boot seeded the full permission catalog and both base roles', async () => {
    const catalogSize = Object.values(MODULE_ACTIONS).flat().length;
    expect(await permissions.count()).toBeGreaterThanOrEqual(catalogSize);
    for (const key of [Role.GROCER, Role.KARDIST]) {
      expect(
        await roles.findOne({ where: { systemKey: key }, withDeleted: true }),
      ).toBeTruthy();
    }
  });

  it('a zero-grant non-admin gets 403 on a permission-gated route', async () => {
    await request(app.getHttpServer())
      .get('/api/categories')
      .set(kardistAuth)
      .expect(403);
  });

  it('…but /auth/me still answers 200 (empty shell, never an auth loop)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(kardistAuth)
      .expect(200);
    expect(res.body.data.permissions).toEqual({});
  });

  it('an explicit role grant opens the route', async () => {
    const perm = await permissions.findOne({
      where: { module: 'categories', action: 'list' },
    });
    expect(perm).toBeTruthy();

    const role = await roles.save(
      roles.create({
        name: `RBAC e2e ${Date.now()}`,
        isSystem: false,
        isActive: true,
      }),
    );
    customRoleId = role.id;
    await rolePermissions.save({ roleId: role.id, permissionId: perm!.id });

    const kardist = await users.findOne({
      where: { clerkId: 'clerk_rbac_kardist' },
    });
    await userRoles.save({
      userId: kardist!.id,
      roleId: role.id,
      assignedBy: null,
    });

    await request(app.getHttpServer())
      .get('/api/categories')
      .set(kardistAuth)
      .expect(200);

    // The grant is action-scoped: create is still denied.
    await request(app.getHttpServer())
      .post('/api/categories')
      .set(kardistAuth)
      .send({ name: 'Nunca', slug: 'nunca' })
      .expect(403);
  });

  it('admins bypass permissions entirely', async () => {
    await request(app.getHttpServer())
      .get('/api/categories')
      .set(adminAuth)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(adminAuth)
      .expect(200);
    expect(res.body.data.permissions.dashboard).toEqual(['view']);
  });
});
