export function generateId(): string {
    return Math.random().toString(36).substring(2)
}

export function sendMessageStart(controller: ReadableStreamDefaultController): void {
    const event = `event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
            id: generateId(),
            type: 'message',
            role: 'assistant',
            content: []
        }
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
            stop_reason: stopReason
        },
        usage
    })}\n\n`
    controller.enqueue(new TextEncoder().encode(event))
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

export async function processProviderStream(
    providerResponse: Response,
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
            let state: ProviderStreamState = {
                textBlockIndex: 0,
                toolUseBlockIndex: 0
            }

            sendMessageStart(controller)

            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const chunk = buffer + decoder.decode(value, { stream: true })
                    const lines = chunk.split('\n')

                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        state = processStreamLine(line, state, processLine, controller)
                    }
                }
            } finally {
                if (buffer.trim() && buffer.startsWith('data: ')) {
                    state = processStreamLine(buffer, state, processLine, controller)
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
    textBlockIndex: number
    toolUseBlockIndex: number
    openTextBlockIndex?: number
    stopReason?: string
    usage?: {
        input_tokens?: number
        output_tokens?: number
    }
    toolCalls?: Record<number, { id?: string; name?: string; arguments: string }>
    events?: string[]
}

function processStreamLine(
    line: string,
    state: ProviderStreamState,
    processLine: (jsonStr: string, state: ProviderStreamState) => ProviderStreamState | null,
    controller: ReadableStreamDefaultController
): ProviderStreamState {
    if (!line.trim() || !line.startsWith('data: ')) return state

    const jsonStr = line.slice(6)
    if (jsonStr === '[DONE]') return state

    const result = processLine(jsonStr, state)
    if (!result) return state

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
            if (typeof value === 'string' && !Array.isArray(cleaned.enum)) {
                cleaned.type = cleaned.type || 'string'
                cleaned.enum = [value]
            }
            continue
        }

        if (key === 'oneOf') {
            cleaned.anyOf = cleanGeminiFunctionSchema(value)
            continue
        }

        if (key === 'format' && schema.type === 'string') {
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
