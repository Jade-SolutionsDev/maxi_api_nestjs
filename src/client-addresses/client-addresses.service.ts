import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { ClientAddressResponseDto } from './dto/client-address-response.dto';
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

export type UpdateClientAddressInput = Partial<CreateClientAddressInput>;

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

    const existing = await this.addressRepository.count({
      where: { clientId },
    });

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

  async findOneForClient(clientId: string, id: string): Promise<ClientAddress> {
    const address = await this.addressRepository.findOne({
      where: { id, clientId },
    });

    // Not 403: a customer must not be able to tell somebody else's address
    // apart from one that never existed.
    if (!address) {
      throw new NotFoundException(`Address with id "${id}" not found`);
    }

    return address;
  }

  async update(
    clientId: string,
    id: string,
    input: UpdateClientAddressInput,
  ): Promise<ClientAddress> {
    const address = await this.findOneForClient(clientId, id);

    if (
      input.municipalityId &&
      input.municipalityId !== address.municipalityId
    ) {
      await this.geographyService.getMunicipalityOrThrow(input.municipalityId);
      address.municipalityId = input.municipalityId;
    }

    if (input.street !== undefined) address.street = input.street;
    // An empty string is how the form says "clear this": it becomes null, so
    // the column never holds a blank pretending to be a value.
    if (input.label !== undefined) address.label = input.label || null;
    if (input.betweenStreets !== undefined) {
      address.betweenStreets = input.betweenStreets || null;
    }
    if (input.reference !== undefined) {
      address.reference = input.reference || null;
    }
    if (input.contactPhone !== undefined) {
      address.contactPhone = input.contactPhone || null;
    }

    // isDefault is deliberately ignored here: promoting an address is its own
    // endpoint, so the invariant lives in exactly one place.

    return this.addressRepository.save(address);
  }

  async remove(clientId: string, id: string): Promise<void> {
    const address = await this.findOneForClient(clientId, id);

    await this.addressRepository.softDelete(id);

    if (!address.isDefault) return;

    // Losing the default silently would leave the customer with addresses and
    // nothing proposed at checkout. The newest survivor takes over.
    const survivor = await this.addressRepository.findOne({
      where: { clientId },
      order: { createdAt: 'DESC' },
    });

    if (survivor) {
      await this.addressRepository.update(
        { id: survivor.id },
        { isDefault: true },
      );
    }
  }

  async setDefault(clientId: string, id: string): Promise<ClientAddress> {
    const address = await this.findOneForClient(clientId, id);

    if (address.isDefault) return address;

    await this.clearDefault(clientId);
    address.isDefault = true;

    return this.addressRepository.save(address);
  }

  /**
   * Resolves municipality and province names for a batch of addresses. The
   * catalog is ~170 rows and cached in Postgres' buffer anyway, so loading it
   * whole beats N lookups per list.
   */
  async toResponse(
    addresses: ClientAddress[],
  ): Promise<ClientAddressResponseDto[]> {
    const [municipalities, provinces] = await Promise.all([
      this.geographyService.listMunicipalities(undefined, { all: true }),
      this.geographyService.listProvinces({ all: true }),
    ]);
    const municipalityById = new Map(municipalities.map((m) => [m.id, m]));
    const provinceById = new Map(provinces.map((p) => [p.id, p]));

    return addresses.map((address) => {
      const municipality = municipalityById.get(address.municipalityId);
      return ClientAddressResponseDto.fromEntity(
        address,
        municipality,
        municipality ? provinceById.get(municipality.provinceId) : undefined,
      );
    });
  }

  async toResponseOne(
    address: ClientAddress,
  ): Promise<ClientAddressResponseDto> {
    const [dto] = await this.toResponse([address]);
    return dto;
  }

  private async clearDefault(clientId: string): Promise<void> {
    await this.addressRepository.update(
      { clientId, isDefault: true },
      { isDefault: false },
    );
  }
}
