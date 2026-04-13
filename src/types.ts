export interface JsonSchema {
    [key: string]: any
    type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | null
    properties?: { [key: string]: JsonSchema }
    required?: string[]
    description?: string
    items?: JsonSchema | JsonSchema[]
    enum?: any[]
    anyOf?: JsonSchema[]
    nullable?: boolean
}

export interface ClaudeTool {
    name: string
    description: string
    input_schema: JsonSchema
}

export type ClaudeContentBlock =
    | { type: 'text'; text: string }
    | {
          type: 'image'
          source:
              | { type: 'base64'; media_type: string; data: string }
              | { type: 'url'; url: string }
              | { type: 'file'; file_id: string }
      }
    | { type: 'tool_use'; id: string; name: string; input: any }
    | {
          type: 'tool_result'
          tool_use_id: string
          content?: string | Array<{ type: 'text'; text: string }>
          is_error?: boolean
      }

export type ClaudeContent = string | ClaudeContentBlock[]

export interface ClaudeMessage {
    role: 'user' | 'assistant'
    content: ClaudeContent
}

export interface ClaudeRequest {
    model: string
    messages: ClaudeMessage[]
    max_tokens?: number
    temperature?: number
    stream?: boolean
    tools?: ClaudeTool[]
    system?: string | Array<{ type: 'text'; text: string }>
    stop_sequences?: string[]
    top_p?: number
    tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'none' } | { type: 'tool'; name: string }
}

export interface ClaudeResponse {
    id: string
    type: 'message'
    role: 'assistant'
    model?: string
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: any }>
    stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens'
    usage?: {
        input_tokens: number
        output_tokens: number
    }
}

export interface GeminiFunctionDeclaration {
    name: string
    description: string
    parameters: JsonSchema
}

export interface GeminiTool {
    functionDeclarations: GeminiFunctionDeclaration[]
}

export type GeminiPart =
    | { text: string; thought?: boolean; thoughtSignature?: string }
    | { inlineData: { mimeType: string; data: string } }
    | { functionCall: { id?: string; name: string; args: any }; thoughtSignature?: string }
    | { functionResponse: { id?: string; name: string; response: any } }

export interface GeminiContent {
    parts: GeminiPart[]
    role?: 'user' | 'model'
}

export interface GeminiRequest {
    contents: GeminiContent[]
    tools?: GeminiTool[]
    systemInstruction?: GeminiContent
    generationConfig?: {
        temperature?: number
        maxOutputTokens?: number
        stopSequences?: string[]
        topP?: number
    }
    toolConfig?: {
        functionCallingConfig: {
            mode?: 'AUTO' | 'ANY' | 'NONE'
            allowedFunctionNames?: string[]
        }
    }
}

export interface GeminiCandidate {
    content?: {
        parts: GeminiPart[]
        role: 'model'
    }
    finishReason?: string
}

export interface GeminiResponse {
    candidates: GeminiCandidate[]
    usageMetadata?: {
        promptTokenCount: number
        candidatesTokenCount: number
        totalTokenCount: number
    }
}

export interface ClaudeStreamEvent {
    type:
        | 'message_start'
        | 'content_block_start'
        | 'content_block_delta'
        | 'content_block_stop'
        | 'message_delta'
        | 'message_stop'
    message?: Partial<ClaudeResponse>
    content_block?: {
        type: 'text' | 'tool_use'
        text?: string
        id?: string
        name?: string
        input?: any
    }
    delta?: {
        type: 'text_delta' | 'input_json_delta'
        text?: string
        partial_json?: string
    }
    index?: number
    usage?: {
        input_tokens: number
        output_tokens: number
    }
}

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: string | null | OpenAIContentPart[]
    tool_calls?: OpenAIToolCall[]
    tool_call_id?: string
}

export type OpenAIContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface OpenAIToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export interface OpenAITool {
    type: 'function'
    function: {
        name: string
        description?: string
        parameters?: any
    }
}

export interface OpenAIRequest {
    model: string
    messages: OpenAIMessage[]
    tools?: OpenAITool[]
    tool_choice?: any
    temperature?: number
    max_tokens?: number
    max_completion_tokens?: number
    stop?: string[]
    top_p?: number
    stream?: boolean
    stream_options?: {
        include_usage?: boolean
    }
}

export interface OpenAIChoice {
    index: number
    message: OpenAIMessage
    finish_reason: string | null
}

export interface OpenAIResponse {
    id: string
    object: string
    created: number
    model: string
    choices: OpenAIChoice[]
    usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
    }
}

export interface OpenAIStreamChoice {
    index: number
    delta: {
        role?: string
        content?: string
        tool_calls?: Array<{
            index: number
            id?: string
            type?: 'function'
            function?: {
                name?: string
                arguments?: string
            }
        }>
    }
    finish_reason?: string | null
}

export interface OpenAIStreamResponse {
    id: string
    object: string
    created: number
    model: string
    choices: OpenAIStreamChoice[]
    usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
    } | null
}
