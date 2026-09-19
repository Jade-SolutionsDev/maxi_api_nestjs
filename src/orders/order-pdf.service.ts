import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { CmsService } from '../cms/cms.service';
import { StorefrontConfig, SupportConfig } from '../config/configuration';
import {
  CancellationReason,
  FulfillmentType,
  Order,
} from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

/** Paleta de la tienda, para que el documento se reconozca como suyo. */
const VERDE = '#2e9e78';
const VERDE_OSCURO = '#1e3d30';
const TINTA = '#15231d';
const GRIS = '#5c6b64';
const LINEA = '#dce4e0';

const MARGEN = 48;
const ANCHO_PAGINA = 595.28; // A4 en puntos
const ALTO_PAGINA = 841.89;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;
const ALTO_PIE = 64;

const dinero = (valor: string | number | null | undefined): string =>
  valor == null
    ? '—'
    : `$${Number(valor).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const fecha = (valor: Date | null | undefined): string =>
  valor
    ? new Date(valor).toLocaleString('es-CU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/**
 * El comprobante de un pedido, en PDF.
 *
 * **No es una factura.** No lleva numeración fiscal correlativa ni es
 * inmutable, y el propio documento lo dice: la factura de verdad es
 * `MxH-0057`, que todavía no existe. Esto es el pedido en papel, para
 * mandárselo al cliente o para archivo.
 *
 * Se compone en el servidor a propósito: así el documento es el mismo venga
 * de donde venga —la administración hoy, un correo adjunto mañana— y no
 * depende del navegador de quien lo pide.
 */
@Injectable()
export class OrderPdfService {
  private readonly logger = new Logger(OrderPdfService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly configService: ConfigService,
    private readonly cmsService: CmsService,
  ) {}

  /** Nombre del archivo: el número del pedido, que es lo que la gente busca. */
  fileNameFor(order: Pick<Order, 'orderNumber' | 'id'>): string {
    return `${order.orderNumber ?? order.id}.pdf`;
  }

  async findOrderOrFail(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: { client: true },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    return order;
  }

  async generate(id: string): Promise<Buffer> {
    const order = await this.findOrderOrFail(id);
    const items = await this.orderItemRepository.find({
      where: { orderId: order.id },
      order: { createdAt: 'ASC' },
    });
    const ajustes = await this.ajustes();
    const tienda = (
      this.configService.get<StorefrontConfig>('storefront')?.url ??
      'https://www.maxihabana.com'
    ).replace(/\/+$/, '');
    const whatsapp =
      this.configService.get<SupportConfig>('support')?.whatsapp ?? '';

    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: MARGEN,
        bottom: MARGEN + ALTO_PIE,
        left: MARGEN,
        right: MARGEN,
      },
      info: {
        Title: `Pedido ${order.orderNumber ?? order.id}`,
        Author: 'Maxi Habana',
        Subject: 'Comprobante de pedido',
      },
      autoFirstPage: false,
      // El pie necesita saber cuántas páginas hay, así que se pinta al final
      // volviendo sobre cada una. Sin esto, `switchToPage` no puede retroceder.
      bufferPages: true,
    });

    const trozos: Buffer[] = [];
    doc.on('data', (trozo: Buffer) => trozos.push(trozo));
    const terminado = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(trozos)));
    });

    doc.addPage();
    this.cabecera(doc, order, ajustes, tienda, whatsapp);
    this.bloqueDelDocumento(doc, order);
    this.datosDeLasPartes(doc, order);
    this.tablaDeProductos(doc, items);
    this.totales(doc, order);
    this.avisos(doc, order);
    this.pieEnTodasLasPaginas(doc, order, ajustes, tienda);

    doc.end();
    return terminado;
  }

  private async ajustes(): Promise<{
    email: string;
    phone: string;
    copyright: string;
    legalLinks: { label: string; slug: string }[];
  }> {
    try {
      const data = await this.cmsService.getSettings();
      return {
        email: data?.contact?.email ?? '',
        phone: data?.contact?.phone ?? '',
        copyright: data?.footer?.copyright ?? '',
        legalLinks: data?.footer?.legalLinks ?? [],
      };
    } catch (err) {
      // El documento vale igual sin el pie del CMS; no vale nada si revienta.
      this.logger.warn(
        `No se pudieron leer los ajustes del sitio para el PDF: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { email: '', phone: '', copyright: '', legalLinks: [] };
    }
  }

  // ---------------- Bloques del documento ----------------

  private cabecera(
    doc: PDFKit.PDFDocument,
    order: Order,
    ajustes: { email: string; phone: string },
    tienda: string,
    whatsapp: string,
  ): void {
    const logo = join(__dirname, 'assets', 'logo-maxi.svg');
    if (existsSync(logo)) {
      try {
        // El logo de la tienda es blanco porque vive sobre fondo oscuro; aquí
        // el papel es blanco, así que se tiñe del verde de la marca.
        const svg = readFileSync(logo, 'utf8').replace(
          /fill="white"/g,
          `fill="${VERDE_OSCURO}"`,
        );
        SVGtoPDF(doc, svg, MARGEN, MARGEN - 6, {
          width: 150,
          height: 53,
          preserveAspectRatio: 'xMinYMin meet',
        });
        doc.y = MARGEN;
      } catch {
        this.tituloDeRespaldo(doc);
      }
    } else {
      this.tituloDeRespaldo(doc);
    }

    const derecha = MARGEN + ANCHO_UTIL / 2;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(TINTA)
      .text('La Meknica Export & Import SRL', derecha, MARGEN - 4, {
        width: ANCHO_UTIL / 2,
        align: 'right',
      });

    const contacto = [
      ajustes.phone || whatsapp,
      ajustes.email,
      tienda.replace(/^https?:\/\//, ''),
    ].filter(Boolean);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS);
    for (const linea of contacto) {
      doc.text(linea, derecha, doc.y, {
        width: ANCHO_UTIL / 2,
        align: 'right',
      });
    }

    doc
      .moveTo(MARGEN, MARGEN + 58)
      .lineTo(MARGEN + ANCHO_UTIL, MARGEN + 58)
      .lineWidth(2)
      .strokeColor(VERDE)
      .stroke();
    doc.y = MARGEN + 74;
  }

  private tituloDeRespaldo(doc: PDFKit.PDFDocument): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor(VERDE_OSCURO)
      .text('maxiHabana', MARGEN, MARGEN);
  }

  private bloqueDelDocumento(doc: PDFKit.PDFDocument, order: Order): void {
    const y = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(TINTA)
      .text('Comprobante de pedido', MARGEN, y);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(VERDE_OSCURO)
      .text(order.orderNumber ?? order.id, MARGEN, doc.y + 2);

    const derecha = MARGEN + ANCHO_UTIL / 2;
    doc.font('Helvetica').fontSize(9).fillColor(GRIS);
    doc.text(`Fecha del pedido: ${fecha(order.createdAt)}`, derecha, y + 2, {
      width: ANCHO_UTIL / 2,
      align: 'right',
    });
    doc.text(
      `Estado: ${this.etiquetaEstado(order.status)}   ·   Pago: ${this.etiquetaPago(order.paymentStatus)}`,
      derecha,
      doc.y,
      { width: ANCHO_UTIL / 2, align: 'right' },
    );
    if (order.paidAt) {
      doc.text(`Cobrado el ${fecha(order.paidAt)}`, derecha, doc.y, {
        width: ANCHO_UTIL / 2,
        align: 'right',
      });
    }
    doc.y = Math.max(doc.y, y + 50) + 12;
  }

  private datosDeLasPartes(doc: PDFKit.PDFDocument, order: Order): void {
    const y = doc.y;
    const anchoCol = (ANCHO_UTIL - 20) / 2;

    const cliente = order.client;
    const nombre =
      [cliente?.firstName, cliente?.lastName].filter(Boolean).join(' ') || '—';
    this.recuadro(doc, 'Cliente', MARGEN, y, anchoCol, [
      nombre,
      cliente?.email ?? '',
      cliente?.phone ?? '',
    ]);

    const esRecogida = order.fulfillmentType === FulfillmentType.PICKUP;
    const contacto = order.contactSnapshot as {
      fullName?: string;
      name?: string;
      idCard?: string;
      phone?: string;
    } | null;
    const recogida = order.pickupAddressSnapshot as {
      locationName?: string;
      label?: string;
      address?: string;
    } | null;
    const entrega = order.deliveryAddress as {
      street?: string;
      city?: string;
      reference?: string;
    } | null;

    const lineasEntrega = esRecogida
      ? [
          'Recogida en mostrador',
          [recogida?.locationName, recogida?.label].filter(Boolean).join(' · '),
          recogida?.address ?? '',
          contacto?.fullName || contacto?.name
            ? `Recoge: ${contacto.fullName ?? contacto.name}${
                contacto.idCard ? ` (${contacto.idCard})` : ''
              }`
            : '',
        ]
      : [
          order.deliveryOptionLabel ?? 'Entrega a domicilio',
          entrega?.street ?? '',
          entrega?.city ?? '',
          contacto?.phone ? `Teléfono: ${contacto.phone}` : '',
        ];

    this.recuadro(
      doc,
      esRecogida ? 'Recogida' : 'Entrega',
      MARGEN + anchoCol + 20,
      y,
      anchoCol,
      lineasEntrega,
    );

    doc.y = y + 92;
  }

  private recuadro(
    doc: PDFKit.PDFDocument,
    titulo: string,
    x: number,
    y: number,
    ancho: number,
    lineas: string[],
  ): void {
    doc
      .roundedRect(x, y, ancho, 82, 6)
      .lineWidth(1)
      .strokeColor(LINEA)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(VERDE)
      .text(titulo.toUpperCase(), x + 12, y + 10, {
        width: ancho - 24,
        characterSpacing: 0.6,
      });
    doc.font('Helvetica').fontSize(9.5).fillColor(TINTA);
    let cursor = y + 24;
    for (const linea of lineas.filter(Boolean)) {
      doc.text(linea, x + 12, cursor, {
        width: ancho - 24,
        ellipsis: true,
        height: 12,
      });
      cursor += 13;
    }
  }

  private tablaDeProductos(doc: PDFKit.PDFDocument, items: OrderItem[]): void {
    const cols = {
      nombre: MARGEN,
      cantidad: MARGEN + 290,
      precio: MARGEN + 350,
      importe: MARGEN + 430,
    };
    const anchoImporte = ANCHO_UTIL - 430;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS);
    const yCabecera = doc.y;
    doc.text('PRODUCTO', cols.nombre, yCabecera, { width: 280 });
    doc.text('CANT.', cols.cantidad, yCabecera, { width: 50, align: 'right' });
    doc.text('PRECIO', cols.precio, yCabecera, { width: 70, align: 'right' });
    doc.text('IMPORTE', cols.importe, yCabecera, {
      width: anchoImporte,
      align: 'right',
    });
    doc
      .moveTo(MARGEN, yCabecera + 14)
      .lineTo(MARGEN + ANCHO_UTIL, yCabecera + 14)
      .lineWidth(1)
      .strokeColor(LINEA)
      .stroke();
    doc.y = yCabecera + 22;

    doc.font('Helvetica').fontSize(10).fillColor(TINTA);
    for (const item of items) {
      const y = doc.y;
      doc.text(item.productNameSnapshot ?? '—', cols.nombre, y, { width: 280 });
      const alto = doc.y - y;
      doc.text(String(item.quantity), cols.cantidad, y, {
        width: 50,
        align: 'right',
      });
      doc.text(dinero(item.unitPrice), cols.precio, y, {
        width: 70,
        align: 'right',
      });
      doc.text(dinero(item.lineTotal), cols.importe, y, {
        width: anchoImporte,
        align: 'right',
      });
      doc.y = y + Math.max(alto, 14) + 6;
      doc
        .moveTo(MARGEN, doc.y - 4)
        .lineTo(MARGEN + ANCHO_UTIL, doc.y - 4)
        .lineWidth(0.5)
        .strokeColor(LINEA)
        .stroke();
    }
    doc.y += 6;
  }

  private totales(doc: PDFKit.PDFDocument, order: Order): void {
    const x = MARGEN + ANCHO_UTIL - 220;
    const linea = (etiqueta: string, valor: string, fuerte = false) => {
      doc
        .font(fuerte ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(fuerte ? 12 : 10)
        .fillColor(fuerte ? TINTA : GRIS)
        .text(etiqueta, x, doc.y, { width: 110 });
      doc
        .font(fuerte ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(fuerte ? 12 : 10)
        .fillColor(TINTA)
        .text(valor, x + 110, doc.y - (fuerte ? 14 : 12), {
          width: 110,
          align: 'right',
        });
      doc.y += 4;
    };

    linea('Subtotal', dinero(order.subtotal));
    linea(
      order.fulfillmentType === FulfillmentType.PICKUP ? 'Recogida' : 'Envío',
      dinero(order.deliveryFee),
    );
    doc
      .moveTo(x, doc.y + 2)
      .lineTo(x + 220, doc.y + 2)
      .lineWidth(1)
      .strokeColor(LINEA)
      .stroke();
    doc.y += 8;
    linea('Total', `${dinero(order.total)} USD`, true);
    doc.y += 10;
  }

  private avisos(doc: PDFKit.PDFDocument, order: Order): void {
    const notas = order.customerNotes?.trim();
    if (notas) {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(VERDE)
        .text('NOTAS DEL CLIENTE', MARGEN, doc.y, { characterSpacing: 0.6 });
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(TINTA)
        .text(notas, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
      doc.y += 14;
    }

    if (order.cancellationReason) {
      const yAviso = doc.y + 4;
      const texto =
        order.cancellationReason === CancellationReason.PAYMENT_NOT_RECEIVED
          ? 'Pedido cancelado automáticamente: no se recibió el pago a tiempo y se liberó el stock.'
          : order.cancellationReason ===
              CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK
            ? 'El pago llegó después de que el pedido caducara y ya no había mercancía. Corresponde devolución.'
            : 'Pedido cancelado.';
      doc.font('Helvetica').fontSize(9.5);
      const altoTexto = doc.heightOfString(texto, { width: ANCHO_UTIL - 24 });
      doc
        .roundedRect(MARGEN, yAviso, ANCHO_UTIL, altoTexto + 20, 5)
        .fillColor('#fdf0e6')
        .fill();
      doc
        .fillColor('#8a4b1a')
        .text(texto, MARGEN + 12, yAviso + 10, { width: ANCHO_UTIL - 24 });
      doc.y = yAviso + altoTexto + 28;
    }
  }

  /**
   * El pie va en todas las páginas y se pinta al final, cuando ya se sabe
   * cuántas hay. Los enlaces salen del CMS y de la URL de la tienda, así que
   * si mañana cambian las páginas legales, cambia el documento.
   */
  private pieEnTodasLasPaginas(
    doc: PDFKit.PDFDocument,
    order: Order,
    ajustes: {
      email: string;
      phone: string;
      copyright: string;
      legalLinks: { label: string; slug: string }[];
    },
    tienda: string,
  ): void {
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i += 1) {
      doc.switchToPage(paginas.start + i);
      // El pie vive por debajo del margen inferior. Sin bajar el margen,
      // pdfkit da el texto por desbordado y abre una página nueva para él.
      doc.page.margins.bottom = 0;
      const y = ALTO_PAGINA - MARGEN - ALTO_PIE + 10;

      doc
        .moveTo(MARGEN, y)
        .lineTo(MARGEN + ANCHO_UTIL, y)
        .lineWidth(1)
        .strokeColor(LINEA)
        .stroke();

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(GRIS)
        .text(
          'Este documento es un comprobante del pedido, no una factura.',
          MARGEN,
          y + 8,
          { width: ANCHO_UTIL * 0.7 },
        );

      const enlacePedido = `${tienda}/pedidos/${order.id}`;
      doc
        .fillColor(VERDE)
        .text('Ver el pedido en la tienda', MARGEN, doc.y + 1, {
          width: ANCHO_UTIL * 0.7,
          link: enlacePedido,
          underline: true,
        });

      // Teléfono y correo, clicables: en un PDF que se manda por WhatsApp
      // eso ahorra copiar y pegar.
      const yContacto = doc.y + 1;
      let xContacto = MARGEN;
      if (ajustes.phone) {
        doc.fillColor(VERDE).text(ajustes.phone, xContacto, yContacto, {
          link: `https://wa.me/${ajustes.phone.replace(/[^0-9]/g, '')}`,
          underline: false,
          lineBreak: false,
        });
        xContacto += doc.widthOfString(ajustes.phone) + 10;
        doc.fillColor(GRIS).text('·', xContacto, yContacto, {
          lineBreak: false,
          link: undefined,
        });
        xContacto += 10;
      }
      if (ajustes.email) {
        doc.fillColor(VERDE).text(ajustes.email, xContacto, yContacto, {
          link: `mailto:${ajustes.email}`,
          underline: false,
          lineBreak: false,
        });
      }
      doc.x = MARGEN;
      doc.y = yContacto + 10;

      let xLegal = MARGEN;
      const yLegal = doc.y + 1;
      for (const enlace of ajustes.legalLinks) {
        const texto = enlace.label;
        const ancho = doc.widthOfString(texto) + 12;
        doc.fillColor(VERDE).text(texto, xLegal, yLegal, {
          link: `${tienda}/paginas/${enlace.slug}`,
          underline: true,
          lineBreak: false,
        });
        xLegal += ancho;
      }

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(GRIS)
        .text(
          ajustes.copyright || 'Maxi Habana',
          MARGEN + ANCHO_UTIL * 0.7,
          y + 8,
          { width: ANCHO_UTIL * 0.3, align: 'right', underline: false },
        );
      doc.text(
        `Emitido el ${fecha(new Date())}`,
        MARGEN + ANCHO_UTIL * 0.7,
        doc.y + 1,
        { width: ANCHO_UTIL * 0.3, align: 'right' },
      );
      doc.text(
        `Página ${i + 1} de ${paginas.count}`,
        MARGEN + ANCHO_UTIL * 0.7,
        doc.y + 1,
        { width: ANCHO_UTIL * 0.3, align: 'right' },
      );
    }
    doc.flushPages();
  }

  private etiquetaEstado(status: string): string {
    const nombres: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmado',
      processing: 'En preparación',
      shipped: 'Enviado',
      delivered: 'Entregado',
      cancelled: 'Cancelado',
    };
    return nombres[status] ?? status;
  }

  private etiquetaPago(status: string): string {
    const nombres: Record<string, string> = {
      pending: 'Pendiente',
      paid: 'Pagado',
      failed: 'Fallido',
      refunded: 'Reembolsado',
    };
    return nombres[status] ?? status;
  }
}
