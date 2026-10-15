import type { AIProvider } from "@/lib/types";

export type AIProviderOption = {
  value: AIProvider;
  label: string;
  endpoint: string;
  suggestedModels: readonly string[];
};

// Suggestions mirror the models Genkit's provider plugins curate. Any other
// model ID the provider serves can still be entered.
export const aiProviders: readonly AIProviderOption[] = [
  {
    value: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    suggestedModels: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4-mini",
    ],
  },
  {
    value: "anthropic",
    label: "Anthropic",
    endpoint: "https://api.anthropic.com",
    suggestedModels: [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-fable-5",
      "claude-haiku-4-5",
    ],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    suggestedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
];

export function aiProviderOption(provider: AIProvider): AIProviderOption {
  return (
    aiProviders.find((option) => option.value === provider) ?? aiProviders[0]
  );
}

export function isAIProvider(value: string): value is AIProvider {
  return aiProviders.some((option) => option.value === value);
}
