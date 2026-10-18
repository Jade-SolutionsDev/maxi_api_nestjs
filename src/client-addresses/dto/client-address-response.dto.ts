import { Municipality } from '../../geography/entities/municipality.entity';
import { Province } from '../../geography/entities/province.entity';
import {
  ClientAddress,
  LocationSource,
} from '../entities/client-address.entity';

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
  recipientName: string | null;
  idCard: string | null;
  contactPhone: string | null;
  /**
   * El punto en el mapa, o `null` si esta dirección no tiene. Viaja como
   * objeto —la misma forma con la que entra— para que el cliente no tenga que
   * recomponer tres campos, y para que «tiene punto» sea una sola pregunta.
   */
  location: {
    latitude: number;
    longitude: number;
    source: LocationSource;
  } | null;
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
    dto.recipientName = address.recipientName;
    dto.idCard = address.idCard;
    dto.contactPhone = address.contactPhone;
    // Las tres se guardan juntas, pero una fila antigua manipulada a mano
    // podría tener media: sin las tres, no hay punto que enseñar.
    dto.location =
      address.latitude !== null &&
      address.longitude !== null &&
      address.locationSource !== null
        ? {
            latitude: address.latitude,
            longitude: address.longitude,
            source: address.locationSource,
          }
        : null;
    dto.isDefault = address.isDefault;
    dto.createdAt = address.createdAt;
    return dto;
  }
}
