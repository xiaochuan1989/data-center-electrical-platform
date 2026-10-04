// Explicit URLs override PDF.js defaults; only resources beside this application.
export function localPdfOptions(base = globalThis.document?.baseURI) {
  const root=new URL('vendor/pdfjs/',base);
  return {cMapUrl:new URL('cmaps/',root).href,cMapPacked:true,
    standardFontDataUrl:new URL('standard_fonts/',root).href,wasmUrl:new URL('wasm/',root).href,
    isEvalSupported:false,enableScripting:false,enableXfa:false,useSystemFonts:false};
}
