export { makeStructuredOutputCompatible } from './utils/schema-converter'
export { createOpenAICompatibleClient } from './utils/client'
export type { OpenAICompatibleClientConfig } from './types/config'
export * from './tools/index'
export * from './types/message-metadata'
export * from './types/provider-options'
export { OpenAICompatibleChatCompletionsTextAdapter } from './adapters/chat-completions-text'
export {
  convertFunctionToolToChatCompletionsFormat,
  convertToolsToChatCompletionsFormat,
  type ChatCompletionFunctionTool,
} from './adapters/chat-completions-tool-converter'
