import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Tesseract from 'tesseract.js';
import spellchecker from 'spellchecker';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import pLimit from 'p-limit';
import Hunspell from 'hunspell-spellchecker'; // Import Hunspell for German spellchecking

// Load Hunspell dictionaries for German
const hunspell = new Hunspell();
const aff = fs.readFileSync('./dictionaries/de_DE.aff'); // Path to German affix file
const dic = fs.readFileSync('./dictionaries/de_DE.dic'); // Path to German dictionary file
hunspell.dictionary = hunspell.parse({ aff, dic });

// For path resolving
const __dirname = path.resolve();

// Define storage for the files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/';
    if (!fs.existsSync(uploadPath)) {
      console.log('Creating uploads directory...');
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    console.log(`Uploading file to directory: ${uploadPath}`);
    cb(null, uploadPath); // specify the destination directory
  },
  filename: (req, file, cb) => {
    const sanitizedFileName = file.originalname.replace(/\s+/g, '-'); // Replace spaces with dashes
    console.log(`Saving file with sanitized name: ${sanitizedFileName}`);
    cb(null, sanitizedFileName); // Set the file name with spaces replaced by dashes
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 10 }, // limit file size to 10MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|pdf|docx/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
      console.log(`File ${file.originalname} passed mimetype and extension check.`);
      return cb(null, true);
    }
    console.log(`File ${file.originalname} failed mimetype or extension check.`);
    cb(new Error('Only images, PDFs, and docx files are allowed!'));
  }
});

// Correct text based on the specified language
async function correctText(text, language) {
  let correctedText = text;
  console.log(`Starting spell check for text in ${language}.`);
  const misspelledLocations = await spellchecker.checkSpellingAsync(text);

  if (misspelledLocations.length > 0) {
    for (let i = misspelledLocations.length - 1; i >= 0; i--) {
      const start = misspelledLocations[i].start;
      const end = misspelledLocations[i].end;
      let wrongword = text.slice(start, end);
      let corrections = [];

      if (language === 'eng') {
        corrections = spellchecker.getCorrectionsForMisspelling(wrongword);
      } else if (language === 'deu') {
        corrections = hunspell.suggest(wrongword); // German correction
      }

      let correctedWord = wrongword;
      if (corrections.length > 0) {
        correctedWord = corrections[0];
      }

      correctedText = correctedText.slice(0, start) + correctedWord + correctedText.slice(end);
    }
  }
  return correctedText;
}

// Correct text with digits for both languages
async function correctTextWithDigits(text, language) {
  console.log(`Correcting text with digits for language: ${language}`);
  const wordRegex = /[a-zA-Z0-9]+[.,!?]?/g;
  let correctedText = text;
  const matches = text.match(wordRegex);

  if (matches) {
    for (let i = 0; i < matches.length; i++) {
      let word = matches[i];
      const punctuation = word.slice(-1).match(/[.,!?]/) ? word.slice(-1) : '';
      const pureWord = punctuation ? word.slice(0, -1) : word;

      let corrections = [];
      if (containsDigits(pureWord) || (language === 'eng' && spellchecker.isMisspelled(pureWord))) {
        corrections = spellchecker.getCorrectionsForMisspelling(pureWord);
      } else if (language === 'deu' && containsDigits(pureWord)) {
        corrections = hunspell.suggest(pureWord); // German correction with digits
      }

      if (corrections.length > 0) {
        const correctedWord = corrections[0] + punctuation;
        correctedText = correctedText.replace(word, correctedWord);
      }
    }
  }
  return correctedText;
}

function containsDigits(word) {
  return /\d/.test(word); 
}

// Function to split PDF into individual pages using pdf-lib
async function splitPdfPages(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const numPages = pdfDoc.getPageCount();
  const pages = [];

  for (let i = 0; i < numPages; i++) {
    const newPdfDoc = await PDFDocument.create();
    const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
    newPdfDoc.addPage(copiedPage);

    const page = pdfDoc.getPage(i);
    let { width, height } = page.getSize(); // Get page dimensions

    const pdfData = await newPdfDoc.save();
    pages.push({ data: pdfData, width, height }); // Store page data and dimensions
  }

  return pages; // Array of individual page PDFs with their dimensions
}

// Function to convert PDF pages to images
async function convertPdfToImages(filePath) {
  console.log(`Starting PDF to image conversion for file: ${filePath}`);

  // Read the PDF
  const pdfBytes = fs.readFileSync(filePath);

  // Split the PDF into individual pages
  const pdfPages = await splitPdfPages(pdfBytes);
  console.log(`PDF has ${pdfPages.length} pages.`);

  const browser = await puppeteer.launch({ headless: true });
  console.log('Puppeteer browser launched...');

  const outputDir = filePath.replace('.pdf', '_images');
  if (!fs.existsSync(outputDir)) {
    console.log(`Creating directory for image output: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const imagePaths = [];
  const limit = pLimit(7); // Limit concurrency to 7

  // Process all pages with a concurrency limit
  const pagePromises = pdfPages.map((pdfPage, i) =>
    limit(async () => {
      const pageIndex = i + 1;
      const pageData = pdfPage.data;
      const pageWidth = pdfPage.width;
      const pageHeight = pdfPage.height;

      // Save the page as a separate PDF file
      const pagePath = path.join(outputDir, `page-${pageIndex}.pdf`);
      fs.writeFileSync(pagePath, pageData);

      const screenshotFiles = [];

      // Process screenshots for the current page concurrently
      const page = await browser.newPage();

      // Set viewport to match the PDF page size
      await page.setViewport({
        width: Math.ceil(pageWidth),
        height: Math.ceil(pageHeight),
        deviceScaleFactor: 2,
      });

      // Load the PDF page in Puppeteer
      await page.goto(`file://${path.resolve(pagePath)}`, { waitUntil: 'networkidle0' });

      await delay(300);  // Delay for stability

      // Take a screenshot
      const imagePath = path.join(outputDir, `page-${pageIndex}.png`);
      await page.screenshot({ path: imagePath, fullPage: true, type: 'png' });

      console.log(`Saved screenshot of page ${pageIndex} at ${imagePath}`);
      screenshotFiles.push(imagePath);

      await page.close(); // Close the page after screenshot
      imagePaths.push(imagePath); // Collect image paths
    })
  );

  // Wait for all page processing to complete
  await Promise.all(pagePromises);

  await browser.close();
  console.log(`Finished PDF to image conversion for file: ${filePath}`);
  return imagePaths; // Return the paths of the images
}

// OCR processing for English and German
async function performOCR(imagePath, language) {
  let textData = [];
  const lang = language === 'eng' ? 'eng' : 'deu'; // Define language based on input
  
  try {
    console.log(`Starting OCR for image: ${imagePath} in language: ${language}`);
    const { data: { text } } = await Tesseract.recognize(
      imagePath,
      lang,
      { logger: info => console.log(info) }
    );
    textData.push(imagePath);
    textData.push(text);
    textData.push(language)
    return textData;
  } catch (err) {
    console.error('Error during OCR:', err);
    throw err;
  }
}

// Data processing with language selection per file
async function dataProcessing(files) {
  let ocrData = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`Processing file ${file.fileName} with language: ${file.language}`);
    
    let imagesToProcess = [];
    if (file.images && file.images.length > 0) {
      imagesToProcess = file.images;
    } else {
      imagesToProcess.push(file.filePath.slice(1)); // Remove leading '/' from filePath
    }

    for (let j = 0; j < imagesToProcess.length; j++) {
      console.log(file.language)
      ocrData.push(await performOCR(imagesToProcess[j], file.language));
    }
  }
  console.log(ocrData)


  for (let k = 0; k < ocrData.length; k++) {
    let text = ocrData[k][1];
    let language = ocrData[k][2]
    console.log(language)
    let fixedText = await correctText(text, language);
    fixedText = await correctTextWithDigits(fixedText, language);
    console.log(`Corrected text: ${fixedText}`);
  }

  return;
}

// Route for file upload with individual language selection per file
const app = express();

app.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    console.log('Starting file upload process...');

    const fileDetails = await Promise.all(req.files.map(async (file, index) => {
      const sanitizedFileName = file.originalname.replace(/\s+/g, '-');
      const filePath = `/uploads/${sanitizedFileName}`;
      const language = req.body[`language_${index}`] || 'eng'; // Get individual language per file

      console.log(`File ${file.originalname} is being processed in language: ${language}`);

      if (file.mimetype === 'application/pdf') {
        const imagePaths = await convertPdfToImages(file.path);
        return { fileName: sanitizedFileName, filePath: filePath, images: imagePaths, language };
      } else {
        return { fileName: sanitizedFileName, filePath: filePath, language };
      }
    }));

    await dataProcessing(fileDetails);

    res.send({
      status: 'success',
      message: `${req.files.length} file(s) uploaded successfully!`,
      files: fileDetails
    });
  } catch (err) {
    console.error('Error during file upload or processing:', err.message);
    res.status(400).send({
      status: 'error',
      message: 'File upload failed!',
      error: err.message
    });
  }
});

// Utility function to introduce a delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Error handling and server setup
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err.message);
    return res.status(400).json({ status: 'error', message: err.message });
  } else if (err) {
    console.error('General error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
  next();
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
