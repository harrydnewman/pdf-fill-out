import { upload } from '../utils/multerConfig.js';
import { dataProcessing } from './textProcessingController.js';
import { convertPdfToImages } from './pdfController.js';

export const uploadFiles = (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      console.error('Error during file upload:', err.message);
      return res.status(400).send({ status: 'error', message: err.message });
    }

    try {
      const fileDetails = await Promise.all(req.files.map(async (file, index) => {
        const sanitizedFileName = file.originalname.replace(/\s+/g, '-');
        const filePath = `/uploads/${sanitizedFileName}`;
        const language = req.body[`language_${index}`] || 'eng';

        if (file.mimetype === 'application/pdf') {
          const imagePaths = await convertPdfToImages(file.path);
          return { fileName: sanitizedFileName, filePath, images: imagePaths, language };
        } else {
          return { fileName: sanitizedFileName, filePath, language };
        }
      }));

      await dataProcessing(fileDetails);

      res.send({
        status: 'success',
        message: `${req.files.length} file(s) uploaded successfully!`,
        files: fileDetails
      });
    } catch (err) {
      console.error('Error during file processing:', err.message);
      res.status(400).send({ status: 'error', message: 'File upload failed!', error: err.message });
    }
  });
};
