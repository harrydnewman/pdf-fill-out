import puppeteer from 'puppeteer';
import { splitPdfPages } from '../services/pdfService.js';
import { delay } from '../utils/delay.js';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit'; // Ensure pLimit is imported

export const convertPdfToImages = async (filePath) => {
  const pdfBytes = fs.readFileSync(filePath);
  const pdfPages = await splitPdfPages(pdfBytes);

  const browser = await puppeteer.launch({ headless: true });
  const outputDir = filePath.replace('.pdf', '_images');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const imagePaths = [];
  const limit = pLimit(7); // Ensure pLimit is used correctly

  const pagePromises = pdfPages.map((pdfPage, i) =>
    limit(async () => {
      const pageIndex = i + 1;
      const pageData = pdfPage.data;
      const pagePath = path.join(outputDir, `page-${pageIndex}.pdf`);
      fs.writeFileSync(pagePath, pageData);

      const page = await browser.newPage();
      await page.setViewport({ width: Math.ceil(pdfPage.width), height: Math.ceil(pdfPage.height), deviceScaleFactor: 2 });
      await page.goto(`file://${path.resolve(pagePath)}`, { waitUntil: 'networkidle0' });
      await delay(300);

      const imagePath = path.join(outputDir, `page-${pageIndex}.png`);
      await page.screenshot({ path: imagePath, fullPage: true });
      imagePaths.push(imagePath);

      await page.close();
    })
  );

  await Promise.all(pagePromises);
  await browser.close();
  return imagePaths;
};
