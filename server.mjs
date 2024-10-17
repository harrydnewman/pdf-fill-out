import express from 'express';
import { uploadFiles } from './controllers/fileUploadController.js';

const app = express();

app.post('/upload', uploadFiles);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
