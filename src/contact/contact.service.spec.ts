import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { User } from '../users/entities/user.entity';
import { ContactMailService } from './contact-mail.service';
import { ContactService } from './contact.service';
import {
  ContactMessage,
  ContactMessageStatus,
} from './entities/contact-message.entity';
import { ContactReplyTemplate } from './entities/contact-reply-template.entity';
import {
  ContactReply,
  ContactReplyChannel,
} from './entities/contact-reply.entity';

const makeMessage = (
  overrides: Partial<ContactMessage> = {},
): ContactMessage => ({
  id: 'msg-1',
  motiveId: 'mot-1',
  clientId: null,
  name: 'Ana',
  lastName: 'Pérez',
  email: 'ana@example.com',
  phone: null,
  message: 'Necesito ayuda con mi pedido, por favor.',
  status: ContactMessageStatus.NUEVO,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

const motive = { id: 'mot-1', label: 'Pedidos' };

type RepoMock = Record<string, jest.Mock>;

const makeRepo = (): RepoMock => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn((input: unknown) => input),
  save: jest.fn((input: unknown) => Promise.resolve(input)),
  softDelete: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ContactService', () => {
  let service: ContactService;
  let messageRepo: RepoMock;
  let replyRepo: RepoMock;
  let templateRepo: RepoMock;
  let nomenclators: {
    findActiveOption: jest.Mock;
    labelsFor: jest.Mock;
  };
  let mail: { configured: boolean; sendReply: jest.Mock };

  beforeEach(async () => {
    messageRepo = makeRepo();
    replyRepo = makeRepo();
    templateRepo = makeRepo();
    nomenclators = {
      findActiveOption: jest.fn().mockResolvedValue(motive),
      labelsFor: jest.fn().mockResolvedValue(new Map([['mot-1', 'Pedidos']])),
    };
    mail = {
      configured: false,
      sendReply: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException('disabled')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: getRepositoryToken(ContactMessage), useValue: messageRepo },
        { provide: getRepositoryToken(ContactReply), useValue: replyRepo },
        {
          provide: getRepositoryToken(ContactReplyTemplate),
          useValue: templateRepo,
        },
        { provide: getRepositoryToken(User), useValue: makeRepo() },
        { provide: NomenclatorsService, useValue: nomenclators },
        { provide: ContactMailService, useValue: mail },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
  });

  describe('submitMessage', () => {
    const anonymousDto = {
      motiveId: 'mot-1',
      message: 'Necesito ayuda con mi pedido, por favor.',
      name: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
    };

    it('guarda un envío anónimo válido', async () => {
      const saved = await service.submitMessage(anonymousDto, null);

      expect(saved).not.toBeNull();
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          motiveId: 'mot-1',
          clientId: null,
          name: 'Ana',
          email: 'ana@example.com',
          status: ContactMessageStatus.NUEVO,
        }),
      );
    });

    it('descarta en silencio cuando el honeypot viene relleno', async () => {
      const result = await service.submitMessage(
        { ...anonymousDto, website: 'http://spam.example' },
        null,
      );

      expect(result).toBeNull();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('exige email o teléfono al remitente anónimo', async () => {
      await expect(
        service.submitMessage(
          {
            motiveId: 'mot-1',
            message: anonymousDto.message,
            name: 'Ana',
            lastName: 'Pérez',
          },
          null,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rechaza un motivo inexistente o inactivo', async () => {
      nomenclators.findActiveOption.mockResolvedValue(null);

      await expect(
        service.submitMessage(anonymousDto, null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('con sesión toma la identidad del Client e ignora la del body', async () => {
      const client = {
        id: 'cli-1',
        firstName: 'Pedro',
        lastName: 'Gómez',
        email: 'pedro@example.com',
        phone: '+53 5 111 2233',
      } as Client;

      await service.submitMessage(
        { ...anonymousDto, name: 'Impostor', email: 'otro@example.com' },
        client,
      );

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'cli-1',
          name: 'Pedro',
          email: 'pedro@example.com',
          phone: '+53 5 111 2233',
        }),
      );
    });
  });

  describe('addReply', () => {
    beforeEach(() => {
      messageRepo.findOne.mockResolvedValue(makeMessage());
      replyRepo.find.mockResolvedValue([]);
      jest.spyOn(service, 'getMessage').mockResolvedValue({} as never);
    });

    it('registra la respuesta y marca el mensaje como respondido', async () => {
      await service.addReply('msg-1', 'user-1', {
        channel: ContactReplyChannel.WHATSAPP,
        body: 'Hola, ya revisamos tu caso.',
      });

      expect(replyRepo.save).toHaveBeenCalled();
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ContactMessageStatus.RESPONDIDO }),
      );
    });

    it('una nota interna no cambia el estado', async () => {
      await service.addReply('msg-1', 'user-1', {
        channel: ContactReplyChannel.NOTA,
        body: 'Cliente llamado, no contesta.',
      });

      expect(replyRepo.save).toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('el canal plataforma responde 503 sin Resend configurado y no registra nada', async () => {
      await expect(
        service.addReply('msg-1', 'user-1', {
          channel: ContactReplyChannel.PLATAFORMA,
          body: 'Respuesta por email.',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(replyRepo.save).not.toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('el canal plataforma exige que el remitente tenga email', async () => {
      messageRepo.findOne.mockResolvedValue(makeMessage({ email: null }));

      await expect(
        service.addReply('msg-1', 'user-1', {
          channel: ContactReplyChannel.PLATAFORMA,
          body: 'Respuesta.',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});
