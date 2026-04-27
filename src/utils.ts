export function generateId(): string {
    return crypto.randomUUID()
}

export function sendMessageStart(controller: ReadableStreamDefaultController, model?: string): void {
    const message: Record<string, unknown> = {
        id: generateId(),
        type: 'message',
        role: 'assistant',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: normalizeUsage()
    }
    if (model !== undefined) {
        message.model = model
    }
    const event = `event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message
    })}\n\n`
    controller.enqueue(new TextEncoder().encode(event))
}

export function sendMessageStop(controller: ReadableStreamDefaultController): void {
    const event = `event: message_stop\ndata: ${JSON.stringify({
        type: 'message_stop'
    })}\n\n`
    controller.enqueue(new TextEncoder().encode(event))
}

export function sendMessageDelta(
    controller: ReadableStreamDefaultController,
    stopReason: string,
    usage?: { input_tokens?: number; output_tokens?: number }
): void {
    const event = `event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: {
            stop_reason: stopReason,
            stop_sequence: null
        },
        usage: normalizeUsage(usage)
    })}\n\n`
    controller.enqueue(new TextEncoder().encode(event))
}

function normalizeUsage(usage?: { input_tokens?: number; output_tokens?: number }): {
    input_tokens: number
    output_tokens: number
} {
    return {
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0
    }
}

export function startTextPart(index: number): string {
    return `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: {
            type: 'text',
            text: ''
        }
    })}\n\n`
}

export function startThinkingPart(index: number): string {
    return `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: {
            type: 'thinking',
            thinking: ''
        }
    })}\n\n`
}

export function processThinkingDelta(text: string, index: number): string {
    return `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: {
            type: 'thinking_delta',
            thinking: text
        }
    })}\n\n`
}

export function processThinkingPart(text: string, index: number): string[] {
    const events: string[] = []
    events.push(startThinkingPart(index))
    events.push(processThinkingDelta(text, index))
    events.push(stopContentBlock(index))
    return events
}

export function processTextDelta(text: string, index: number): string {
    return `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: {
            type: 'text_delta',
            text
        }
    })}\n\n`
}

export function stopContentBlock(index: number): string {
    return `event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index
    })}\n\n`
}

export function processTextPart(text: string, index: number): string[] {
    const events: string[] = []

    events.push(startTextPart(index))
    events.push(processTextDelta(text, index))
    events.push(stopContentBlock(index))

    return events
}

export function processToolUsePart(functionCall: { id?: string; name: string; args: any }, index: number): string[] {
    const events: string[] = []
    const toolUseId = functionCall.id || generateId()

    events.push(
        `event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index,
            content_block: {
                type: 'tool_use',
                id: toolUseId,
                name: functionCall.name,
                input: {}
            }
        })}\n\n`
    )

    events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index,
            delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(functionCall.args)
            }
        })}\n\n`
    )

    events.push(
        `event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index
        })}\n\n`
    )

    return events
}

export function buildUrl(baseUrl: string, endpoint: string): string {
    let finalUrl = baseUrl
    if (!finalUrl.endsWith('/')) {
        finalUrl += '/'
    }
    return finalUrl + endpoint
}

export class HttpError extends Error {
    response: Response

    constructor(response: Response) {
        super(response.statusText || 'HTTP error')
        this.response = response
    }
}

export function badRequest(message: string): never {
    throw new HttpError(new Response(message, { status: 400 }))
}

export function isHttpError(error: unknown): error is HttpError {
    return error instanceof HttpError
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = ''
    const bytes = new Uint8Array(buffer)

    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }

    return btoa(binary)
}

export async function processProviderStream(
    providerResponse: Response,
    model: string | undefined,
    processLine: (jsonStr: string, state: ProviderStreamState) => ProviderStreamState | null
): Promise<Response> {
    const stream = new ReadableStream({
        async start(controller) {
            const reader = providerResponse.body?.getReader()
            if (!reader) {
                controller.close()
                return
            }

            const decoder = new TextDecoder()
            let buffer = ''
            let messageStartSent = false
            let state: ProviderStreamState = {
                nextBlockIndex: 0,
                model
            }

            const ensureMessageStart = () => {
                if (!messageStartSent) {
                    sendMessageStart(controller, state.model)
                    messageStartSent = true
                }
            }

            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const chunk = buffer + decoder.decode(value, { stream: true })
                    const lines = chunk.split('\n')

                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        state = processStreamLine(line, state, processLine, controller, ensureMessageStart)
                    }
                }
            } finally {
                ensureMessageStart()
                if (buffer.trim() && buffer.startsWith('data: ')) {
                    state = processStreamLine(buffer, state, processLine, controller, ensureMessageStart)
                }
                if (state.openThinkingBlockIndex !== undefined) {
                    controller.enqueue(new TextEncoder().encode(stopContentBlock(state.openThinkingBlockIndex)))
                }
                if (state.openTextBlockIndex !== undefined) {
                    controller.enqueue(new TextEncoder().encode(stopContentBlock(state.openTextBlockIndex)))
                }
                reader.releaseLock()
                sendMessageDelta(controller, state.stopReason || 'end_turn', state.usage)
                sendMessageStop(controller)
                controller.close()
            }
        }
    })

    return new Response(stream, {
        status: providerResponse.status,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        }
    })
}

export interface ProviderStreamState {
    nextBlockIndex: number
    openTextBlockIndex?: number
    openThinkingBlockIndex?: number
    stopReason?: string
    usage?: {
        input_tokens?: number
        output_tokens?: number
    }
    toolCalls?: Record<number, { id?: string; name?: string; arguments: string }>
    events?: string[]
    model?: string
}

export function closeThinkingIfOpen(state: ProviderStreamState, events: string[]): void {
    if (state.openThinkingBlockIndex !== undefined) {
        events.push(stopContentBlock(state.openThinkingBlockIndex))
        state.openThinkingBlockIndex = undefined
    }
}

function processStreamLine(
    line: string,
    state: ProviderStreamState,
    processLine: (jsonStr: string, state: ProviderStreamState) => ProviderStreamState | null,
    controller: ReadableStreamDefaultController,
    ensureMessageStart: () => void
): ProviderStreamState {
    if (!line.trim() || !line.startsWith('data: ')) return state

    const jsonStr = line.slice(6)
    if (jsonStr === '[DONE]') return state

    const result = processLine(jsonStr, state)
    if (!result) return state

    if (result.events && result.events.length > 0) {
        ensureMessageStart()
    }

    for (const event of result.events || []) {
        controller.enqueue(new TextEncoder().encode(event))
    }

    const { events, ...nextState } = result
    return nextState
}

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
    '$schema',
    'additionalProperties',
    'title',
    'examples',
    'propertyNames',
    'patternProperties',
    'unevaluatedProperties',
    'dependencies',
    'dependentSchemas',
    'if',
    'then',
    'else',
    'allOf',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'default'
])

const OPENAI_DROP_SCHEMA_KEYS = new Set(['$schema'])

export function cleanGeminiFunctionSchema(schema: any): any {
    if (Array.isArray(schema)) {
        return schema.map(item => cleanGeminiFunctionSchema(item))
    }

    if (!schema || typeof schema !== 'object') {
        return schema
    }

    const cleaned: Record<string, any> = {}

    for (const [key, value] of Object.entries(schema)) {
        if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
            continue
        }

        if (key === 'const') {
            if (!Array.isArray(cleaned.enum)) {
                if (cleaned.type === undefined) {
                    if (typeof value === 'string') cleaned.type = 'string'
                    else if (typeof value === 'number') cleaned.type = Number.isInteger(value) ? 'integer' : 'number'
                    else if (typeof value === 'boolean') cleaned.type = 'boolean'
                }
                cleaned.enum = [value]
            }
            continue
        }

        if (key === 'oneOf') {
            cleaned.anyOf = cleanGeminiFunctionSchema(value)
            continue
        }

        if (key === 'format') {
            continue
        }

        cleaned[key] = cleanGeminiFunctionSchema(value)
    }

    return cleaned
}

export function cleanOpenAIFunctionSchema(schema: any): any {
    if (Array.isArray(schema)) {
        return schema.map(item => cleanOpenAIFunctionSchema(item))
    }

    if (!schema || typeof schema !== 'object') {
        return schema
    }

    const cleaned: Record<string, any> = {}

    for (const [key, value] of Object.entries(schema)) {
        if (OPENAI_DROP_SCHEMA_KEYS.has(key)) {
            continue
        }

        cleaned[key] = cleanOpenAIFunctionSchema(value)
    }

    return cleaned
}
