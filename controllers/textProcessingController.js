import { correctText, correctTextWithDigits } from '../utils/spellCheck.js';
import { performOCR } from './ocrController.js';

export const dataProcessing = async (files) => {
  let ocrData = [];

  for (const file of files) {
    const imagesToProcess = file.images.length > 0 ? file.images : [file.filePath.slice(1)];

    for (const image of imagesToProcess) {
      ocrData.push(await performOCR(image, file.language));
    }
  }

  for (const data of ocrData) {
    const text = data[1];
    const language = data[2];
    let fixedText = await correctText(text, language);
    fixedText = await correctTextWithDigits(fixedText, language);
    console.log(`Corrected text: ${fixedText}`);
  }

  return;
};
