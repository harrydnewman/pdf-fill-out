import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib'; // Import pdf-lib to handle splitting the PDF

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
    console.log("pdf width:", width, "pdf height:", height)
    width = width - 200;

    const pdfData = await newPdfDoc.save();
    pages.push({ data: pdfData, width, height }); // Store page data and dimensions
  }

  return pages; // Array of individual page PDFs with their dimensions
}

// Function to introduce a delay using setTimeout
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function convertPdfToImages(filePath) {
  console.log(`Starting PDF to image conversion for file: ${filePath}`);

  // Read the PDF
  const pdfBytes = fs.readFileSync(filePath);
  
  // Split the PDF into individual pages
  const pdfPages = await splitPdfPages(pdfBytes);
  console.log(`PDF has ${pdfPages.length} pages.`);

  const browser = await puppeteer.launch({ headless: false }); // Launch Chromium in visible mode
  console.log('Puppeteer browser launched...');

  const outputDir = filePath.replace('.pdf', '_images');
  if (!fs.existsSync(outputDir)) {
    console.log(`Creating directory for image output: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const imagePaths = [];

  for (let i = 0; i < pdfPages.length; i++) {
    console.log(`Rendering page ${i + 1} of the PDF...`);

    const pageData = pdfPages[i].data;
    const pageWidth = pdfPages[i].width;
    const pageHeight = pdfPages[i].height;

    // Save each split page as a separate file
    const pagePath = path.join(outputDir, `page-${i + 1}.pdf`);
    fs.writeFileSync(pagePath, pageData);

    const screenshotFiles = [];

    for (let round = 1; round <= 3; round++) {
      const page = await browser.newPage();

      // Set viewport to match the PDF page size and increase the resolution with deviceScaleFactor
      await page.setViewport({
        width: Math.ceil(pageWidth), // Match page width
        height: Math.ceil(pageHeight), // Match page height
        deviceScaleFactor: 2 // Increase the scale factor for higher quality
      });

      // Disable default PDF viewer to remove unnecessary elements
      await page.goto(`file://${path.resolve(pagePath)}`, { waitUntil: 'networkidle0' });
      console.log(`Went to the page (round ${round})`);

      await delay(1000);  // Wait for 1 second

      // Take a high-quality screenshot of the page
      const imagePath = path.join(outputDir, `page-${i + 1}-round-${round}.png`);
      await page.screenshot({ path: imagePath, fullPage: true, type: 'png' }); // PNG format for higher quality
      console.log(`Saved screenshot of page ${i + 1} (round ${round}) at ${imagePath}`);

      screenshotFiles.push(imagePath);
      await page.close(); // Close the page after screenshot
    }

    // Compare file sizes and keep the largest one
    const largestFile = await findLargestFile(screenshotFiles);
    imagePaths.push(largestFile);

    // Delete other files except for the largest one
    await deleteOtherFiles(screenshotFiles, largestFile);
  }

  await browser.close();
  console.log(`Finished PDF to image conversion for file: ${filePath}`);
  return imagePaths; // Return the paths of the final images
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
      fs.unlinkSync(file); // Delete the file
      console.log(`Deleted file ${file}`);
    }
  }
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
