import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { StorefrontConfig, SupportConfig } from '../config/configuration';
import { OrderResponseDto } from './dto/order-response.dto';

/** La misma paleta que el comprobante: los dos documentos son de la misma casa. */
const VERDE_OSCURO = '#1e3d30';
const TINTA = '#15231d';
const GRIS = '#5c6b64';
const LINEA = '#dce4e0';
const FILA_ALTERNA = '#f3f8f6';

const MARGEN = 40;
/** A4 apaisado: la tabla tiene siete columnas y de pie no caben. */
const ANCHO_PAGINA = 841.89;
const ALTO_PAGINA = 595.28;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;
const ALTO_CABECERA = 62;
const ALTO_PIE = 40;

interface Columna {
  clave: string;
  titulo: string;
  ancho: number;
  /** Los importes se leen alineados a la derecha, como en cualquier factura. */
  derecha?: boolean;
}

const COLUMNAS: Columna[] = [
  { clave: 'numero', titulo: 'PEDIDO', ancho: 95 },
  { clave: 'cliente', titulo: 'CLIENTE', ancho: 190 },
  { clave: 'estado', titulo: 'ESTADO', ancho: 80 },
  { clave: 'pago', titulo: 'PAGO', ancho: 75 },
  { clave: 'metodo', titulo: 'MÉTODO', ancho: 130 },
  { clave: 'total', titulo: 'TOTAL', ancho: 90, derecha: true },
  { clave: 'fecha', titulo: 'CREADO', ancho: 102 },
];

const ESTADOS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  processing: 'En proceso',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

const PAGOS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  failed: 'Fallido',
  refunded: 'Reembolsado',
};

const dinero = (valor: string | number | null | undefined): string =>
  valor == null
    ? '—'
    : `$${Number(valor).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const fechaCorta = (valor: Date | string | null | undefined): string => {
  if (!valor) return '—';
  const d = new Date(valor);
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1,
  ).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(
    2,
    '0',
  )}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fechaLarga = (valor: string): string => {
  const d = new Date(valor);
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1,
  ).padStart(2, '0')}/${d.getFullYear()}`;
};

export interface FiltrosDelReporte {
  from?: string;
  to?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  q?: string;
}

export interface TotalPorEstado {
  estado: string;
  pedidos: number;
  importe: string;
}

/**
 * El reporte de pedidos del panel (MxH-0120).
 *
 * Aparte de `OrderPdfService`, que hace el comprobante de **un** pedido: son
 * dos documentos distintos —uno va al cliente, este se queda dentro— y mezclar
 * los dos en una clase obligaba a que cada método preguntara cuál de los dos
 * estaba dibujando. Comparten la paleta y el logo, que es lo que los hace
 * reconocibles como de la misma casa.
 */
@Injectable()
export class OrdersReportPdfService {
  constructor(private readonly configService: ConfigService) {}

  async generate(
    pedidos: OrderResponseDto[],
    totales: TotalPorEstado[],
    filtros: FiltrosDelReporte,
    recortado = false,
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: [ANCHO_PAGINA, ALTO_PAGINA],
      margins: {
        top: MARGEN + ALTO_CABECERA,
        bottom: MARGEN + ALTO_PIE,
        left: MARGEN,
        right: MARGEN,
      },
      info: {
        Title: 'Reporte de pedidos — Maxi Habana',
        Author: 'Maxi Habana',
        Subject: 'Listado de pedidos',
      },
      autoFirstPage: false,
      // El pie dice «página X de Y», así que hay que poder volver sobre las
      // páginas ya escritas cuando se sabe cuántas son.
      bufferPages: true,
    });

    const trozos: Buffer[] = [];
    doc.on('data', (trozo: Buffer) => trozos.push(trozo));
    const terminado = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(trozos)));
    });

    doc.addPage();
    this.titulo(doc, filtros, pedidos.length, recortado);
    this.tabla(doc, pedidos);
    this.totales(doc, totales);
    this.marcaEnTodasLasPaginas(doc, filtros);

    doc.end();
    return terminado;
  }

  /** Nombre del fichero: que diga qué contiene sin abrirlo. */
  nombreDelFichero(filtros: FiltrosDelReporte): string {
    const partes = ['pedidos'];
    if (filtros.from) partes.push(filtros.from.slice(0, 10));
    if (filtros.to) partes.push(filtros.to.slice(0, 10));
    if (filtros.status) partes.push(ESTADOS[filtros.status] ?? filtros.status);
    if (filtros.paymentStatus) {
      partes.push(PAGOS[filtros.paymentStatus] ?? filtros.paymentStatus);
    }
    return `${partes
      .join('-')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9-]/g, '')}.pdf`;
  }

  /** Los filtros, en palabras, para que el papel diga qué se está mirando. */
  private filtrosEnPalabras(filtros: FiltrosDelReporte): string {
    const partes: string[] = [];
    if (filtros.from && filtros.to) {
      partes.push(
        `Del ${fechaLarga(filtros.from)} al ${fechaLarga(filtros.to)}`,
      );
    } else if (filtros.from) {
      partes.push(`Desde el ${fechaLarga(filtros.from)}`);
    } else if (filtros.to) {
      partes.push(`Hasta el ${fechaLarga(filtros.to)}`);
    } else {
      partes.push('Todas las fechas');
    }
    if (filtros.status) {
      partes.push(`Estado: ${ESTADOS[filtros.status] ?? filtros.status}`);
    }
    if (filtros.paymentStatus) {
      partes.push(
        `Pago: ${PAGOS[filtros.paymentStatus] ?? filtros.paymentStatus}`,
      );
    }
    if (filtros.paymentMethod) {
      partes.push(`Método: ${filtros.paymentMethod}`);
    }
    if (filtros.q) partes.push(`Búsqueda: «${filtros.q}»`);
    return partes.join('  ·  ');
  }

  private titulo(
    doc: PDFKit.PDFDocument,
    filtros: FiltrosDelReporte,
    cuantos: number,
    recortado: boolean,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(TINTA)
      .text('Reporte de pedidos', MARGEN, MARGEN + ALTO_CABECERA - 14);

    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(GRIS)
      .text(this.filtrosEnPalabras(filtros), MARGEN, doc.y + 3, {
        width: ANCHO_UTIL,
      });

    if (recortado) {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#a04a00')
        .text(
          `Se muestran los ${cuantos} más recientes: el filtro abarca más pedidos de los que caben en un documento. Acota el rango de fechas para verlos todos.`,
          MARGEN,
          doc.y + 4,
          { width: ANCHO_UTIL },
        );
    }
    doc.moveDown(0.8);
  }

  private tabla(doc: PDFKit.PDFDocument, pedidos: OrderResponseDto[]): void {
    if (!pedidos.length) {
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(GRIS)
        .text('Ningún pedido cumple estos filtros.', MARGEN, doc.y + 10);
      return;
    }

    this.cabeceraDeTabla(doc);
    doc.font('Helvetica').fontSize(8.5);

    pedidos.forEach((pedido, i) => {
      // Cuando la fila no cabe, la página nueva repite los encabezados: una
      // tabla que sigue en la página siguiente sin decir qué es cada columna
      // obliga a volver atrás para leerla.
      if (doc.y > ALTO_PAGINA - MARGEN - ALTO_PIE - 24) {
        doc.addPage();
        doc.y = MARGEN + ALTO_CABECERA;
        this.cabeceraDeTabla(doc);
        doc.font('Helvetica').fontSize(8.5);
      }

      const y = doc.y;
      if (i % 2 === 1) {
        doc
          .rect(MARGEN, y - 3, ANCHO_UTIL, 17)
          .fillColor(FILA_ALTERNA)
          .fill();
      }

      const valores: Record<string, string> = {
        numero: pedido.orderNumber ?? '—',
        cliente: pedido.clientName || pedido.clientEmail || '—',
        estado: ESTADOS[pedido.status] ?? pedido.status,
        pago: PAGOS[pedido.paymentStatus] ?? pedido.paymentStatus,
        metodo: pedido.paymentMethod?.label ?? '—',
        total: dinero(pedido.total),
        fecha: fechaCorta(pedido.createdAt),
      };

      let x = MARGEN;
      for (const col of COLUMNAS) {
        doc.fillColor(TINTA).text(valores[col.clave] ?? '—', x + 4, y, {
          width: col.ancho - 8,
          align: col.derecha ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
        x += col.ancho;
      }
      doc.y = y + 14;
    });
  }

  private cabeceraDeTabla(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc
      .rect(MARGEN, y - 4, ANCHO_UTIL, 18)
      .fillColor(VERDE_OSCURO)
      .fill();

    let x = MARGEN;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    for (const col of COLUMNAS) {
      doc.text(col.titulo, x + 4, y, {
        width: col.ancho - 8,
        align: col.derecha ? 'right' : 'left',
        lineBreak: false,
      });
      x += col.ancho;
    }
    doc.y = y + 16;
  }

  private totales(doc: PDFKit.PDFDocument, totales: TotalPorEstado[]): void {
    if (!totales.length) return;

    if (doc.y > ALTO_PAGINA - MARGEN - ALTO_PIE - 110) {
      doc.addPage();
      doc.y = MARGEN + ALTO_CABECERA;
    }

    doc.moveDown(1);
    const y = doc.y;
    doc
      .moveTo(MARGEN, y)
      .lineTo(MARGEN + ANCHO_UTIL, y)
      .lineWidth(1)
      .strokeColor(LINEA)
      .stroke();

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(TINTA)
      .text('TOTALES', MARGEN, y + 10);
    doc.moveDown(0.4);

    const anchoEtiqueta = 220;
    let sumaPedidos = 0;
    let sumaImporte = 0;

    doc.font('Helvetica').fontSize(9.5);
    for (const fila of totales) {
      sumaPedidos += fila.pedidos;
      sumaImporte += Number(fila.importe);
      const yFila = doc.y;
      doc
        .fillColor(GRIS)
        .text(ESTADOS[fila.estado] ?? fila.estado, MARGEN, yFila, {
          width: anchoEtiqueta,
        });
      doc
        .fillColor(TINTA)
        .text(`${fila.pedidos}`, MARGEN + anchoEtiqueta, yFila, {
          width: 60,
          align: 'right',
        });
      doc
        .fillColor(TINTA)
        .text(dinero(fila.importe), MARGEN + anchoEtiqueta + 70, yFila, {
          width: 110,
          align: 'right',
        });
      doc.y = yFila + 14;
    }

    const yTotal = doc.y + 2;
    doc
      .moveTo(MARGEN, yTotal)
      .lineTo(MARGEN + anchoEtiqueta + 180, yTotal)
      .strokeColor(LINEA)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA);
    doc.text('Total', MARGEN, yTotal + 6, { width: anchoEtiqueta });
    doc.text(`${sumaPedidos}`, MARGEN + anchoEtiqueta, yTotal + 6, {
      width: 60,
      align: 'right',
    });
    doc.text(dinero(sumaImporte), MARGEN + anchoEtiqueta + 70, yTotal + 6, {
      width: 110,
      align: 'right',
    });
  }

  /**
   * Cabecera y pie en **todas** las páginas, no solo en la primera: una hoja
   * suelta de un reporte de doce tiene que seguir diciendo de quién es, qué
   * filtro la produjo y cuándo se sacó.
   */
  private marcaEnTodasLasPaginas(
    doc: PDFKit.PDFDocument,
    filtros: FiltrosDelReporte,
  ): void {
    const tienda = (
      this.configService.get<StorefrontConfig>('storefront')?.url ??
      'https://www.maxihabana.com'
    ).replace(/\/+$/, '');
    const whatsapp =
      this.configService.get<SupportConfig>('support')?.whatsapp ?? '';
    const generado = fechaCorta(new Date());
    const paginas = doc.bufferedPageRange();

    for (let i = 0; i < paginas.count; i += 1) {
      doc.switchToPage(paginas.start + i);
      // El pie vive por debajo del margen inferior; sin bajarlo, pdfkit lo da
      // por desbordado y abre una página más para él.
      doc.page.margins.bottom = 0;
      doc.page.margins.top = 0;

      this.logo(doc);
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(TINTA)
        .text('La Meknica Export & Import SRL', MARGEN, MARGEN + 2, {
          width: ANCHO_UTIL,
          align: 'right',
        });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(GRIS)
        .text(
          [whatsapp, tienda.replace(/^https?:\/\//, '')]
            .filter(Boolean)
            .join('  ·  '),
          MARGEN,
          MARGEN + 15,
          { width: ANCHO_UTIL, align: 'right' },
        );

      const yPie = ALTO_PAGINA - MARGEN - ALTO_PIE + 14;
      doc
        .moveTo(MARGEN, yPie)
        .lineTo(MARGEN + ANCHO_UTIL, yPie)
        .lineWidth(1)
        .strokeColor(LINEA)
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(GRIS)
        .text(
          `Documento interno · ${this.filtrosEnPalabras(filtros)} · Generado el ${generado}`,
          MARGEN,
          yPie + 7,
          { width: ANCHO_UTIL * 0.75, lineBreak: false, ellipsis: true },
        );
      doc.text(
        `Página ${i + 1} de ${paginas.count}`,
        MARGEN + ANCHO_UTIL * 0.75,
        yPie + 7,
        { width: ANCHO_UTIL * 0.25, align: 'right' },
      );
    }
  }

  /** El mismo logo del comprobante, teñido para papel blanco. */
  private logo(doc: PDFKit.PDFDocument): void {
    const ruta = join(__dirname, 'assets', 'logo-maxi.svg');
    if (!existsSync(ruta)) {
      doc
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor(VERDE_OSCURO)
        .text('Maxi Habana', MARGEN, MARGEN);
      return;
    }
    try {
      const svg = readFileSync(ruta, 'utf8').replace(
        /fill="white"/g,
        `fill="${VERDE_OSCURO}"`,
      );
      SVGtoPDF(doc, svg, MARGEN, MARGEN - 8, {
        width: 120,
        height: 42,
        preserveAspectRatio: 'xMinYMin meet',
      });
    } catch {
      doc
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor(VERDE_OSCURO)
        .text('Maxi Habana', MARGEN, MARGEN);
    }
  }
}
