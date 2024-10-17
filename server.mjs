import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer'; // Import puppeteer

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

// Function to convert PDF pages to images using Puppeteer
async function convertPdfToImages(filePath) {
  console.log(`Starting PDF to image conversion for file: ${filePath}`);

  const browser = await puppeteer.launch(); // Launch Chromium
  console.log('Puppeteer browser launched...');

  const page = await browser.newPage(); // Open a new page
  const outputDir = filePath.replace('.pdf', '_images');

  if (!fs.existsSync(outputDir)) {
    console.log(`Creating directory for image output: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await page.goto(`file://${path.resolve(filePath)}`, { waitUntil: 'networkidle0' });
  console.log(`Opened PDF in Puppeteer: ${filePath}`);

  const numPages = await page.pdf({ path: filePath }).then(async () => {
    console.log('Getting dimensions of the PDF for screenshot...');
    const dimensions = await page.evaluate(() => {
      return {
        width: document.body.scrollWidth,
        height: document.body.scrollHeight
      };
    });
    console.log(`PDF Dimensions - Width: ${dimensions.width}, Height: ${dimensions.height}`);

    const pages = [];
    for (let i = 0; i < dimensions.height; i += dimensions.height) {
      const imagePath = path.join(outputDir, `page-${i + 1}.png`);
      console.log(`Taking screenshot for page ${i + 1} at path: ${imagePath}`);
      await page.screenshot({ path: imagePath, clip: { x: 0, y: i, width: dimensions.width, height: dimensions.height } });
      pages.push(imagePath);
    }

    return pages.length;
  });

  await browser.close(); // Close the browser
  console.log(`Finished PDF to image conversion for file: ${filePath}`);
  return numPages; // Return the number of images generated
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
