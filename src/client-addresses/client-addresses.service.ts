import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { AddressLocationDto } from './dto/address-location.dto';
import { ClientAddressResponseDto } from './dto/client-address-response.dto';
import { ClientAddress } from './entities/client-address.entity';

// A customer with more saved addresses than this is not a customer, it is a
// filling script. The cap is deliberate and cheap to raise.
export const MAX_ADDRESSES_PER_CLIENT = 20;

/**
 * Las tres columnas del punto se escriben **siempre juntas**, y por eso solo
 * se tocan aquí. Media coordenada, o una coordenada sin procedencia, es una
 * fila que nadie sabe interpretar después.
 *
 * El DTO ya garantiza que un `location` presente viene completo; esta función
 * se ocupa del otro lado, el borrado: `null` deja las tres en `null`.
 */
const aplicarUbicacion = (
  address: ClientAddress,
  location: AddressLocationDto | null,
): void => {
  if (location === null) {
    address.latitude = null;
    address.longitude = null;
    address.locationSource = null;
    return;
  }

  address.latitude = location.latitude;
  address.longitude = location.longitude;
  address.locationSource = location.source;
};

export interface CreateClientAddressInput {
  recipientName?: string;
  idCard?: string;
  label?: string;
  street: string;
  betweenStreets?: string;
  reference?: string;
  municipalityId: string;
  contactPhone?: string;
  /** El punto en el mapa. `null` lo quita; omitirlo lo deja como estaba. */
  location?: AddressLocationDto | null;
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

    const address = this.addressRepository.create({
      clientId,
      label: input.label ?? null,
      street: input.street,
      betweenStreets: input.betweenStreets ?? null,
      reference: input.reference ?? null,
      municipalityId: input.municipalityId,
      recipientName: input.recipientName ?? null,
      idCard: input.idCard ?? null,
      contactPhone: input.contactPhone ?? null,
      isDefault,
    });

    aplicarUbicacion(address, input.location ?? null);

    return this.addressRepository.save(address);
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
    if (input.recipientName !== undefined) {
      address.recipientName = input.recipientName || null;
    }
    if (input.idCard !== undefined) {
      address.idCard = input.idCard || null;
    }
    if (input.contactPhone !== undefined) {
      address.contactPhone = input.contactPhone || null;
    }

    // `undefined` es «no toques el punto» y `null` es «quítalo». Son dos cosas
    // distintas y aquí es donde se separan: un `?? address.latitude` las
    // confundiría y el punto no se podría borrar nunca.
    if (input.location !== undefined) {
      aplicarUbicacion(address, input.location);
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
