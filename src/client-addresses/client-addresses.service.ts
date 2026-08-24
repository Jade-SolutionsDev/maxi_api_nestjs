import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { ClientAddress } from './entities/client-address.entity';

// A customer with more saved addresses than this is not a customer, it is a
// filling script. The cap is deliberate and cheap to raise.
export const MAX_ADDRESSES_PER_CLIENT = 20;

export interface CreateClientAddressInput {
  label?: string;
  street: string;
  betweenStreets?: string;
  reference?: string;
  municipalityId: string;
  contactPhone?: string;
  isDefault?: boolean;
}

// Saved addresses are strictly per-client: every read and every write is scoped
// by clientId, and a row belonging to somebody else is reported as missing
// rather than forbidden, so the endpoint never confirms it exists.
@Injectable()
export class ClientAddressesService {
  constructor(
    @InjectRepository(ClientAddress)
    private readonly addressRepository: Repository<ClientAddress>,
    private readonly geographyService: GeographyService,
  ) {}

  findAllForClient(clientId: string): Promise<ClientAddress[]> {
    return this.addressRepository.find({
      where: { clientId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async create(
    clientId: string,
    input: CreateClientAddressInput,
  ): Promise<ClientAddress> {
    // Throws NotFoundException when the municipality is not in the catalog.
    await this.geographyService.getMunicipalityOrThrow(input.municipalityId);

    const existing = await this.addressRepository.count({ where: { clientId } });

    if (existing >= MAX_ADDRESSES_PER_CLIENT) {
      throw new ConflictException(
        `A customer cannot have more than ${MAX_ADDRESSES_PER_CLIENT} saved addresses`,
      );
    }

    // The first address is the default one whether or not it was asked for:
    // a customer with addresses but no default has no answer at checkout.
    const isDefault = existing === 0 ? true : (input.isDefault ?? false);

    if (isDefault && existing > 0) await this.clearDefault(clientId);

    return this.addressRepository.save(
      this.addressRepository.create({
        clientId,
        label: input.label ?? null,
        street: input.street,
        betweenStreets: input.betweenStreets ?? null,
        reference: input.reference ?? null,
        municipalityId: input.municipalityId,
        contactPhone: input.contactPhone ?? null,
        isDefault,
      }),
    );
  }

  private async clearDefault(clientId: string): Promise<void> {
    await this.addressRepository.update(
      { clientId, isDefault: true },
      { isDefault: false },
    );
  }
}
