export interface CorrectionPromptParts {
  instructions: string;
  input: string;
}

export function buildCorrectionPromptParts(
  transcript: string,
  sourceLanguage = "auto",
  targetLanguage = ""
): CorrectionPromptParts {
  const normalizedTargetLanguage = targetLanguage.trim();
  const shouldTranslate = normalizedTargetLanguage.length > 0;
  const sourceLanguageInstruction =
    !sourceLanguage || sourceLanguage === "auto"
      ? "Infer the source language from the transcript when it is not obvious."
      : `The source language is ${sourceLanguage}.`;
  const outputLanguageInstruction = shouldTranslate
    ? `Translate the corrected transcript into ${normalizedTargetLanguage}. The final output must be entirely in ${normalizedTargetLanguage}.`
    : "Keep the corrected transcript in the original language.";

  return {
    instructions: [
      "You clean up speech-to-text output before it is typed into another app.",
      "Correct obvious transcription mistakes, capitalization, spacing, and word boundaries.",
      shouldTranslate
        ? "When a target language is provided, first understand the intended meaning, then produce a natural translation in that target language."
        : "Do not translate unless explicitly instructed.",
      "Preserve the user's wording and meaning as closely as possible.",
      "Do not add explanations, quotes, markdown, bullet points, or commentary.",
      "Preserve spoken command phrases exactly when they appear intentional, including words like comma, period, full stop, question mark, exclamation mark, colon, semicolon, quote, open quote, close quote, apostrophe, new line, new paragraph, tab, open bracket, close bracket, open parenthesis, close parenthesis, open brace, close brace, slash, backslash, dash, underscore, plus, equals.",
      "Do not convert those command phrases into punctuation or symbols. Leave them as words so a later text-command pass can handle them.",
      sourceLanguageInstruction,
      outputLanguageInstruction,
      "Return only the final corrected transcript text.",
    ].join(" "),
    input: transcript,
  };
}

export function buildCorrectionUserPrompt(
  transcript: string,
  sourceLanguage = "auto",
  targetLanguage = ""
): string {
  const prompt = buildCorrectionPromptParts(transcript, sourceLanguage, targetLanguage);
  return [prompt.instructions, "", prompt.input].join("\n");
}
