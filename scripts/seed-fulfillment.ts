import { DataSource } from 'typeorm';
import { DeliveryOption } from '../src/fulfillment/entities/delivery-option.entity';
import { DeliveryOptionZone } from '../src/fulfillment/entities/delivery-option-zone.entity';
import { Province } from '../src/geography/entities/province.entity';
import { StockLocation } from '../src/stock-locations/entities/stock-location.entity';
import { StockLocationCoverage } from '../src/stock-locations/entities/stock-location-coverage.entity';
import { StockLocationPickupAddress } from '../src/stock-locations/entities/stock-location-pickup-address.entity';

/**
 * Deja la tienda en condiciones de vender.
 *
 * Sin una opción de entrega que cubra la zona del cliente, `/checkout` se cierra
 * entero y muestra «no podemos procesar pedidos en línea» — que suena a avería
 * y no a «falta configurar» (MxH-0093). Una instalación nueva nace así, con las
 * tablas vacías, de modo que arranca **sin poder vender** y nada lo avisa.
 *
 * Crea una entrega a domicilio por cada provincia que algún almacén activo
 * cubra, y un punto de recogida por almacén que no tenga ninguno. Aditivo e
 * idempotente: se identifica por nombre y por zona, no duplica y no borra nada.
 * Repetirlo es seguro.
 *
 * Ejecutar: pnpm run seed:fulfillment
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const ETIQUETA_ENTREGA = 'Entrega a domicilio';
const TARIFA_POR_DEFECTO = process.env.SEED_DELIVERY_FEE ?? '5.00';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [
    DeliveryOption,
    DeliveryOptionZone,
    Province,
    StockLocation,
    StockLocationCoverage,
    StockLocationPickupAddress,
  ],
});

async function main(): Promise<void> {
  await dataSource.initialize();

  const provincias = await dataSource.query<{ id: string; name: string }[]>(`
    SELECT DISTINCT p.id, p.name
      FROM provinces p
      JOIN stock_location_coverage c ON c.province_id = p.id
      JOIN stock_locations sl ON sl.id = c.location_id AND sl.is_active
     ORDER BY p.name
  `);

  if (provincias.length === 0) {
    console.log(
      'Ningún almacén activo cubre ninguna provincia. Configura la cobertura de los almacenes antes de esto: sin ella no hay nada que entregar.',
    );
    await dataSource.destroy();
    return;
  }

  const opciones = dataSource.getRepository(DeliveryOption);
  let opcion = await opciones.findOne({ where: { label: ETIQUETA_ENTREGA } });

  if (!opcion) {
    opcion = await opciones.save(
      opciones.create({
        label: ETIQUETA_ENTREGA,
        description: 'Te llevamos el pedido a la dirección que nos indiques.',
        fee: TARIFA_POR_DEFECTO,
        sortOrder: 0,
        enabled: true,
      }),
    );
    console.log(`Creada la opción «${ETIQUETA_ENTREGA}» con tarifa ${TARIFA_POR_DEFECTO}.`);
  } else {
    console.log(`La opción «${ETIQUETA_ENTREGA}» ya existía: se respeta su tarifa (${opcion.fee}).`);
  }

  const zonas = dataSource.getRepository(DeliveryOptionZone);
  let zonasNuevas = 0;

  for (const provincia of provincias) {
    const yaEsta = await zonas.findOne({
      where: { optionId: opcion.id, provinceId: provincia.id },
    });
    if (yaEsta) continue;

    await zonas.save(
      zonas.create({ optionId: opcion.id, provinceId: provincia.id, municipalityId: null }),
    );
    zonasNuevas += 1;
    console.log(`  · ${provincia.name}: cubierta`);
  }

  console.log(
    zonasNuevas > 0
      ? `${zonasNuevas} provincia(s) añadidas a la entrega a domicilio.`
      : 'Todas las provincias con cobertura ya estaban en la entrega a domicilio.',
  );

  // Un punto de recogida por almacén: es gratis y no depende de mensajería.
  const almacenes = await dataSource.query<{ id: string; name: string }[]>(`
    SELECT sl.id, sl.name
      FROM stock_locations sl
     WHERE sl.is_active
       AND NOT EXISTS (
         SELECT 1 FROM stock_location_pickup_addresses p WHERE p.location_id = sl.id)
  `);

  const recogidas = dataSource.getRepository(StockLocationPickupAddress);
  for (const almacen of almacenes) {
    await recogidas.save(
      recogidas.create({
        locationId: almacen.id,
        label: 'Mostrador',
        /**
         * El almacén no guarda dirección postal, así que aquí va su nombre y
         * queda a la vista para que alguien lo complete desde la
         * administración: es lo que el cliente lee para saber dónde recoger.
         */
        address: almacen.name,
      }),
    );
    console.log(`  · punto de recogida creado en ${almacen.name}`);
  }

  console.log(
    almacenes.length > 0
      ? `${almacenes.length} punto(s) de recogida creados.`
      : 'Todos los almacenes activos ya tenían punto de recogida.',
  );

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
