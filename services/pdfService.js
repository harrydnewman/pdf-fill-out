import { PDFDocument } from 'pdf-lib';

export const splitPdfPages = async (pdfBytes) => {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const numPages = pdfDoc.getPageCount();
  const pages = [];

  for (let i = 0; i < numPages; i++) {
    const newPdfDoc = await PDFDocument.create();
    const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
    newPdfDoc.addPage(copiedPage);
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();
    const pdfData = await newPdfDoc.save();
    pages.push({ data: pdfData, width, height });
  }
  return pages;
};
