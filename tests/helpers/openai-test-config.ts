export function requireOpenAIApiKeyForTests(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for integration tests. Example: OPENAI_API_KEY=your_key bun test"
    );
  }
  return apiKey;
}

export function getOpenAITestModel(): string {
  return process.env.OPENAI_TEST_MODEL?.trim() || "gpt-4o-transcribe";
}
