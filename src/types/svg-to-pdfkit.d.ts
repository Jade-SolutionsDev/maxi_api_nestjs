/**
 * `svg-to-pdfkit` no publica tipos. Solo se usa una función, así que se
 * declara aquí en lugar de arrastrar `any` por el servicio del comprobante.
 */
declare module 'svg-to-pdfkit' {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    useCSS?: boolean;
    assumePt?: boolean;
  }

  function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: SVGtoPDFOptions,
  ): void;

  export = SVGtoPDF;
}
