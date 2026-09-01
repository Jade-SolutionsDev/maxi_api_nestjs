import { Municipality } from '../../geography/entities/municipality.entity';
import { Province } from '../../geography/entities/province.entity';
import { ClientAddress } from '../entities/client-address.entity';

// The province is resolved here, not stored: the storefront gets both names
// ready to print without a second catalog round-trip.
export class ClientAddressResponseDto {
  id: string;
  label: string | null;
  street: string;
  betweenStreets: string | null;
  reference: string | null;
  municipalityId: string;
  municipalityName: string;
  provinceId: string;
  provinceName: string;
  contactPhone: string | null;
  isDefault: boolean;
  createdAt: Date;

  static fromEntity(
    address: ClientAddress,
    municipality: Municipality | undefined,
    province: Province | undefined,
  ): ClientAddressResponseDto {
    const dto = new ClientAddressResponseDto();
    dto.id = address.id;
    dto.label = address.label;
    dto.street = address.street;
    dto.betweenStreets = address.betweenStreets;
    dto.reference = address.reference;
    dto.municipalityId = address.municipalityId;
    // A municipality that vanished from the catalog leaves the address
    // readable instead of blowing up the whole list.
    dto.municipalityName = municipality?.name ?? '';
    dto.provinceId = province?.id ?? '';
    dto.provinceName = province?.name ?? '';
    dto.contactPhone = address.contactPhone;
    dto.isDefault = address.isDefault;
    dto.createdAt = address.createdAt;
    return dto;
  }
}
