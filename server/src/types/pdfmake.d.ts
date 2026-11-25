// pdfmake 0.3 ships no typings; only the small surface the report exporter uses is declared here.
declare module 'pdfmake' {
  interface PdfOutput {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfMake {
    setFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(policy: ((url: string) => boolean) | undefined): void;
    setLocalAccessPolicy(policy: ((path: string) => boolean) | undefined): void;
    createPdf(definition: Record<string, unknown>): PdfOutput;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}
