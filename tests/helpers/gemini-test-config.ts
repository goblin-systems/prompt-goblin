export function requireGeminiApiKeyForTests(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is required for integration tests. Example: GEMINI_API_KEY=your_key bun test"
    );
  }
  return apiKey;
}
