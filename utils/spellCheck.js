import spellchecker from 'spellchecker';
import Hunspell from 'hunspell-spellchecker';
import fs from 'fs';

// Load Hunspell for German
const hunspell = new Hunspell();
const aff = fs.readFileSync('./dictionaries/de_DE.aff');
const dic = fs.readFileSync('./dictionaries/de_DE.dic');
hunspell.dictionary = hunspell.parse({ aff, dic });

export const correctText = async (text, language) => {
  let correctedText = text;
  const misspelledLocations = await spellchecker.checkSpellingAsync(text);

  if (misspelledLocations.length > 0) {
    for (let i = misspelledLocations.length - 1; i >= 0; i--) {
      const start = misspelledLocations[i].start;
      const end = misspelledLocations[i].end;
      let wrongword = text.slice(start, end);
      let corrections = language === 'eng'
        ? spellchecker.getCorrectionsForMisspelling(wrongword)
        : hunspell.suggest(wrongword);

      if (corrections.length > 0) {
        correctedText = correctedText.slice(0, start) + corrections[0] + correctedText.slice(end);
      }
    }
  }
  return correctedText;
};

export const correctTextWithDigits = async (text, language) => {
  const wordRegex = /[a-zA-Z0-9]+[.,!?]?/g;
  let correctedText = text;
  const matches = text.match(wordRegex);

  if (matches) {
    for (const word of matches) {
      const punctuation = word.slice(-1).match(/[.,!?]/) ? word.slice(-1) : '';
      const pureWord = punctuation ? word.slice(0, -1) : word;

      let corrections = [];
      if (containsDigits(pureWord) || (language === 'eng' && spellchecker.isMisspelled(pureWord))) {
        corrections = spellchecker.getCorrectionsForMisspelling(pureWord);
      } else if (language === 'deu' && containsDigits(pureWord)) {
        corrections = hunspell.suggest(pureWord);
      }

      if (corrections.length > 0) {
        correctedText = correctedText.replace(word, corrections[0] + punctuation);
      }
    }
  }
  return correctedText;
};

const containsDigits = (word) => /\d/.test(word);
