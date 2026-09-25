import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';
import { ClientInvitationsService } from './client-invitations.service';
import { Client } from './entities/client.entity';

const clerk = {
  users: { getUserList: jest.fn() },
  invitations: {
    createInvitation: jest.fn(),
    getInvitationList: jest.fn(),
    revokeInvitation: jest.fn(),
  },
};

jest.mock('@clerk/backend', () => ({
  createClerkClient: () => clerk,
}));

const TIENDA = 'https://staging.maxihabana.com';
const ENLACE = 'https://accounts.example.com/invitation?ticket=abc';

describe('ClientInvitationsService', () => {
  let service: ClientInvitationsService;
  let repo: { findOne: jest.Mock };
  let mail: { send: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    clerk.users.getUserList.mockResolvedValue({ totalCount: 0, data: [] });
    clerk.invitations.getInvitationList.mockResolvedValue({ data: [] });
    clerk.invitations.createInvitation.mockResolvedValue({
      id: 'inv_1',
      url: ENLACE,
    });
    repo = { findOne: jest.fn().mockResolvedValue(null) };
    mail = {
      send: jest.fn().mockResolvedValue({ status: EmailStatus.SENT }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientInvitationsService,
        { provide: getRepositoryToken(Client), useValue: repo },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            // Las claves, tal como las pide el servicio: `clerk.secretKey` es
            // anidada y las otras dos vienen como objeto.
            get: (clave: string): unknown =>
              ({
                'clerk.secretKey': 'sk_test_x',
                storefront: { url: TIENDA },
                support: { whatsapp: '+53 5251 9414' },
              })[clave],
          },
        },
      ],
    }).compile();

    service = module.get(ClientInvitationsService);
  });

  it('crea la invitación en Clerk y manda el correo nosotros', async () => {
    const r = await service.invite({ email: 'Nueva@Ejemplo.com' });

    // `notify: false` es la clave: Clerk ya se ha visto aceptar una invitación
    // y no entregar nada, y el enlace es lo único que el cliente tiene.
    expect(clerk.invitations.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: 'nueva@ejemplo.com',
        notify: false,
      }),
    );
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'nueva@ejemplo.com',
        template: 'client_invitation',
      }),
    );
    expect(r.emailSent).toBe(true);
    expect(r.url).toBe(ENLACE);
  });

  it('el correo lleva el enlace, que es lo único que sirve para entrar', async () => {
    await service.invite({ email: 'nueva@ejemplo.com', firstName: 'Meylin' });

    const { html, subject } = mail.send.mock.calls[0][0] as {
      html: string;
      subject: string;
    };
    expect(html).toContain(ENLACE);
    expect(subject).toContain('Meylin');
  });

  it('no invita a quien ya es cliente', async () => {
    repo.findOne.mockResolvedValue({ id: 'c1' });

    await expect(
      service.invite({ email: 'ya@ejemplo.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
  });

  /**
   * Es el caso de MxH-0097: gente con cuenta en Clerk y sin fila en `clients`.
   * Invitarlos otra vez no arregla nada y encima falla en Clerk.
   */
  it('no invita a quien ya tiene cuenta aunque no salga en el listado', async () => {
    clerk.users.getUserList.mockResolvedValue({ totalCount: 1, data: [{}] });

    await expect(
      service.invite({ email: 'desparejado@ejemplo.com' }),
    ).rejects.toThrow(/ya tiene cuenta/);
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
  });

  it('retira la invitación vieja antes de crear la nueva', async () => {
    clerk.invitations.getInvitationList.mockResolvedValue({
      data: [{ id: 'inv_vieja', emailAddress: 'Nueva@ejemplo.com' }],
    });

    await service.invite({ email: 'nueva@ejemplo.com' });

    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledWith(
      'inv_vieja',
    );
  });

  it('un correo que no sale no deja al cliente sin invitación', async () => {
    mail.send.mockResolvedValue({
      status: EmailStatus.FAILED,
      error: 'dominio sin verificar',
    });

    const r = await service.invite({ email: 'nueva@ejemplo.com' });

    // La invitación vale igual y el panel enseña el enlace para darlo a mano.
    expect(r.emailSent).toBe(false);
    expect(r.url).toBe(ENLACE);
  });
});
