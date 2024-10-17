import Tesseract from 'tesseract.js';

export const performOCR = async (imagePath, language) => {
  try {
    const { data: { text } } = await Tesseract.recognize(
      imagePath,
      language === 'eng' ? 'eng' : 'deu',
      { logger: info => console.log(info) }
    );
    return [imagePath, text, language];
  } catch (err) {
    console.error('Error during OCR:', err);
    throw err;
  }
};
