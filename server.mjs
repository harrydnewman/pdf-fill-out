import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib'; // Import pdf-lib to handle splitting the PDF
import pLimit from 'p-limit'; // Limit concurrency

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
    console.log(`Saving file with original name: ${file.originalname}`);
    cb(null, file.originalname); // Set the file name to be the original name
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

// Function to split PDF into individual pages using pdf-lib and extract page dimensions
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
    console.log("pdf width:", width, "pdf height:", height);
    width = width - 200;
    height = height - 200

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

  const browser = await puppeteer.launch({ headless: true }); // Launch Chromium in visible mode
  console.log('Puppeteer browser launched...');

  const outputDir = filePath.replace('.pdf', '_images');
  if (!fs.existsSync(outputDir)) {
    console.log(`Creating directory for image output: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const imagePaths = [];
  const limit = pLimit(3); // Limit concurrency to 10

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

      // Process 3 rounds of screenshots for the current page concurrently
      const roundPromises = [1, 2, 3].map(async (round) => {
        const page = await browser.newPage();

        // Set viewport to match the PDF page size
        await page.setViewport({
          width: Math.ceil(pageWidth),
          height: Math.ceil(pageHeight),
          deviceScaleFactor: 7
        });

        // Load the PDF page in Puppeteer
        await page.goto(`file://${path.resolve(pagePath)}`, { waitUntil: 'networkidle0' });
        console.log(`Processing page ${pageIndex} (round ${round})...`);

        await delay(300);  // Delay for stability

        // Take a screenshot
        const imagePath = path.join(outputDir, `page-${pageIndex}-round-${round}.png`);
        await page.screenshot({ path: imagePath, fullPage: true, type: 'png' });

        console.log(`Saved screenshot of page ${pageIndex} (round ${round}) at ${imagePath}`);
        screenshotFiles.push(imagePath);

        await page.close(); // Close the page after screenshot
      });

      // Wait for all rounds of screenshots to complete
      await Promise.all(roundPromises);

      // Find the largest file for the page and delete the rest
      const largestFile = await findLargestFile(screenshotFiles);
      imagePaths.push(largestFile);

      // Delete other files except for the largest one
      await deleteOtherFiles(screenshotFiles, largestFile);
    })
  );

  // Wait for all page processing to complete
  await Promise.all(pagePromises);

  await browser.close();
  console.log(`Finished PDF to image conversion for file: ${filePath}`);
  return imagePaths; // Return the paths of the largest images
}

// Function to find the largest file by size
async function findLargestFile(files) {
  let largestFile = files[0];
  let largestFileSize = fs.statSync(files[0]).size;

  for (let i = 1; i < files.length; i++) {
    const fileSize = fs.statSync(files[i]).size;
    if (fileSize > largestFileSize) {
      largestFile = files[i];
      largestFileSize = fileSize;
    }
  }

  console.log(`Largest file is ${largestFile} with size ${largestFileSize} bytes.`);
  return largestFile;
}

// Function to delete other files except for the largest one
async function deleteOtherFiles(files, largestFile) {
  for (const file of files) {
    if (file !== largestFile) {
      try {
        fs.unlinkSync(file); // Delete the file
        console.log(`Deleted file ${file}`);
      } catch (err) {
        console.error(`Error deleting file ${file}:`, err);
      }
    }
  }
}

// Utility function to introduce a delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



const app = express();

// Set up a route for multiple file uploads
app.post('/upload', upload.array('files', 10), async (req, res) => {
  console.log('Received file upload request...');
  try {
    const fileDetails = await Promise.all(req.files.map(async (file) => {
      const filePath = `/uploads/${file.originalname}`;
      console.log(`Processing file: ${file.originalname}`);

      // Check if the uploaded file is a PDF
      if (file.mimetype === 'application/pdf') {
        console.log(`Converting PDF ${file.originalname} to images...`);
        const imagePaths = await convertPdfToImages(file.path); // Convert PDF pages to images
        return { fileName: file.originalname, filePath: filePath, images: imagePaths };
      } else {
        console.log(`File ${file.originalname} is not a PDF, skipping conversion.`);
        return { fileName: file.originalname, filePath: filePath };
      }
    }));

    console.log('File upload and processing completed successfully!');

    console.log("processing submitted data")
    // run the image text getting thing on all the pdfs and stuff, make sure to do this in english and german and then feed it to chat gpt and see if it can decide which one to use
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

// Error handler for multer errors
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
