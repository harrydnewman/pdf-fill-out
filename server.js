const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Define storage for the files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath); // specify the destination directory
  },
  filename: (req, file, cb) => {
    // Set the file name to be the original name
    cb(null, file.originalname);
  }
});

// Set up multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 10, // limit file size to 10MB
  },
  fileFilter: (req, file, cb) => {
    // Optional: Restrict file types
    const filetypes = /jpeg|jpg|png|gif|pdf|docx/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images, PDFs, and docx files are allowed!'));
  }
});

// Set up a route for multiple file uploads
app.post('/upload', upload.array('files', 10), (req, res) => {
  try {
    const files = req.files.map(file => ({
      fileName: file.originalname,
      filePath: `/uploads/${file.originalname}`
    }));

    res.send({
      status: 'success',
      message: `${req.files.length} file(s) uploaded successfully!`,
      files: files
    });
  } catch (err) {
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
    return res.status(400).json({ status: 'error', message: err.message });
  } else if (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
  next();
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
