import * as types from './types'
import * as provider from './provider'
import * as utils from './utils'

export class impl implements provider.Provider {
    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const geminiRequest = this.convertToGeminiRequestBody(claudeRequest)

        const endpoint = `models/${claudeRequest.model}:${claudeRequest.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
        const finalUrl = utils.buildUrl(baseUrl, endpoint)

        const headers = new Headers(request.headers)
        headers.set('x-goog-api-key', apiKey)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(geminiRequest)
        })
    }

    async convertToClaudeResponse(geminiResponse: Response): Promise<Response> {
        if (!geminiResponse.ok) {
            return geminiResponse
        }

        const contentType = geminiResponse.headers.get('content-type') || ''
        const isStream = contentType.includes('text/event-stream')

        if (isStream) {
            return this.convertStreamResponse(geminiResponse)
        } else {
            return this.convertNormalResponse(geminiResponse)
        }
    }

    private convertToGeminiRequestBody(claudeRequest: types.ClaudeRequest): types.GeminiRequest {
        const toolUseMap = this.buildToolUseMap(claudeRequest.messages)
        const contents = this.convertMessages(claudeRequest.messages, toolUseMap)

        const geminiRequest: types.GeminiRequest = {
            contents
        }

        const systemInstruction = this.convertSystemInstruction(claudeRequest.system)
        if (systemInstruction) {
            geminiRequest.systemInstruction = systemInstruction
        }

        if (claudeRequest.tools && claudeRequest.tools.length > 0) {
            geminiRequest.tools = [
                {
                    functionDeclarations: claudeRequest.tools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: utils.cleanGeminiFunctionSchema(tool.input_schema)
                    }))
                }
            ]
        }

        const toolConfig = this.convertToolChoice(claudeRequest.tool_choice)
        if (toolConfig) {
            geminiRequest.toolConfig = toolConfig
        }

        if (
            claudeRequest.temperature !== undefined ||
            claudeRequest.max_tokens !== undefined ||
            claudeRequest.stop_sequences !== undefined ||
            claudeRequest.top_p !== undefined
        ) {
            geminiRequest.generationConfig = {}
            if (claudeRequest.temperature !== undefined) {
                geminiRequest.generationConfig.temperature = claudeRequest.temperature
            }
            if (claudeRequest.max_tokens !== undefined) {
                geminiRequest.generationConfig.maxOutputTokens = claudeRequest.max_tokens
            }
            if (claudeRequest.stop_sequences !== undefined) {
                geminiRequest.generationConfig.stopSequences = claudeRequest.stop_sequences
            }
            if (claudeRequest.top_p !== undefined) {
                geminiRequest.generationConfig.topP = claudeRequest.top_p
            }
        }

        return geminiRequest
    }

    private convertSystemInstruction(system: types.ClaudeRequest['system']): types.GeminiContent | undefined {
        if (!system) {
            return undefined
        }

        if (typeof system === 'string') {
            return {
                parts: [{ text: system }]
            }
        }

        const parts = system
            .filter(content => content.type === 'text' && content.text)
            .map(content => ({ text: content.text }))

        if (parts.length === 0) {
            return undefined
        }

        return { parts }
    }

    private convertToolChoice(toolChoice: types.ClaudeRequest['tool_choice']): types.GeminiRequest['toolConfig'] {
        if (!toolChoice) {
            return undefined
        }

        switch (toolChoice.type) {
            case 'auto':
                return { functionCallingConfig: { mode: 'AUTO' } }
            case 'any':
                return { functionCallingConfig: { mode: 'ANY' } }
            case 'none':
                return { functionCallingConfig: { mode: 'NONE' } }
            case 'tool':
                return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.name] } }
        }
    }

    private buildToolUseMap(messages: types.ClaudeMessage[]): Map<string, string> {
        const toolUseMap = new Map<string, string>()

        for (const message of messages) {
            if (typeof message.content === 'string') continue

            for (const content of message.content) {
                if (content.type === 'tool_use') {
                    toolUseMap.set(content.id, content.name)
                }
            }
        }

        return toolUseMap
    }

    private convertMessages(messages: types.ClaudeMessage[], toolUseMap: Map<string, string>): types.GeminiContent[] {
        const contents: types.GeminiContent[] = []

        for (const message of messages) {
            if (typeof message.content === 'string') {
                contents.push({
                    parts: [{ text: message.content }],
                    role: message.role === 'assistant' ? 'model' : 'user'
                })
                continue
            }

            const textParts: types.GeminiPart[] = []
            const toolUseParts: types.GeminiPart[] = []
            const toolResultParts: types.GeminiPart[] = []

            for (const content of message.content) {
                switch (content.type) {
                    case 'text':
                        textParts.push({ text: content.text })
                        break
                    case 'tool_use':
                        toolUseParts.push({
                            functionCall: {
                                id: content.id,
                                name: content.name,
                                args: content.input
                            }
                        })
                        break
                    case 'tool_result':
                        const functionName = toolUseMap.get(content.tool_use_id)
                        if (functionName) {
                            toolResultParts.push({
                                functionResponse: {
                                    id: content.tool_use_id,
                                    name: functionName,
                                    response: { content: content.content }
                                }
                            })
                        }
                        break
                }
            }

            if (textParts.length > 0 || toolUseParts.length > 0) {
                contents.push({
                    parts: [...textParts, ...toolUseParts],
                    role: message.role === 'assistant' ? 'model' : 'user'
                })
            }

            if (toolResultParts.length > 0) {
                contents.push({
                    parts: toolResultParts,
                    role: 'user'
                })
            }
        }

        return contents
    }

    private async convertNormalResponse(geminiResponse: Response): Promise<Response> {
        const geminiData = (await geminiResponse.json()) as types.GeminiResponse

        const claudeResponse: types.ClaudeResponse = {
            id: utils.generateId(),
            type: 'message',
            role: 'assistant',
            content: []
        }

        if (geminiData.candidates && geminiData.candidates.length > 0) {
            const candidate = geminiData.candidates[0]
            let hasToolUse = false

            for (const part of candidate.content.parts) {
                if ('text' in part && !part.thought) {
                    claudeResponse.content.push({
                        type: 'text',
                        text: part.text
                    })
                } else if ('functionCall' in part) {
                    hasToolUse = true
                    claudeResponse.content.push({
                        type: 'tool_use',
                        id: part.functionCall.id || utils.generateId(),
                        name: part.functionCall.name,
                        input: part.functionCall.args
                    })
                }
            }

            if (hasToolUse) {
                claudeResponse.stop_reason = 'tool_use'
            } else if (candidate.finishReason === 'MAX_TOKENS') {
                claudeResponse.stop_reason = 'max_tokens'
            } else {
                claudeResponse.stop_reason = 'end_turn'
            }
        }

        if (geminiData.usageMetadata) {
            claudeResponse.usage = {
                input_tokens: geminiData.usageMetadata.promptTokenCount,
                output_tokens: geminiData.usageMetadata.candidatesTokenCount
            }
        }

        return new Response(JSON.stringify(claudeResponse), {
            status: geminiResponse.status,
            headers: {
                'Content-Type': 'application/json'
            }
        })
    }

    private async convertStreamResponse(geminiResponse: Response): Promise<Response> {
        return utils.processProviderStream(geminiResponse, (jsonStr, state) => {
            const geminiData = JSON.parse(jsonStr) as types.GeminiResponse
            if (!geminiData.candidates || geminiData.candidates.length === 0) {
                return null
            }

            const candidate = geminiData.candidates[0]
            const events: string[] = []
            let nextState: utils.ProviderStreamState = { ...state, events }

            if (candidate.content) {
                for (const part of candidate.content.parts) {
                    if ('text' in part && part.text && !part.thought) {
                        if (nextState.openTextBlockIndex === undefined) {
                            nextState.openTextBlockIndex = nextState.textBlockIndex
                            nextState.textBlockIndex++
                            events.push(utils.startTextPart(nextState.openTextBlockIndex))
                        }
                        events.push(utils.processTextDelta(part.text, nextState.openTextBlockIndex))
                    } else if ('functionCall' in part) {
                        if (nextState.openTextBlockIndex !== undefined) {
                            events.push(utils.stopContentBlock(nextState.openTextBlockIndex))
                            nextState.openTextBlockIndex = undefined
                        }
                        events.push(...utils.processToolUsePart(part.functionCall, nextState.toolUseBlockIndex))
                        nextState.toolUseBlockIndex++
                        nextState.stopReason = 'tool_use'
                    }
                }
            }

            if (geminiData.usageMetadata) {
                nextState.usage = {
                    input_tokens: geminiData.usageMetadata.promptTokenCount,
                    output_tokens: geminiData.usageMetadata.candidatesTokenCount
                }
            }

            if (candidate.finishReason && nextState.stopReason !== 'tool_use') {
                nextState.stopReason = this.convertFinishReason(candidate.finishReason)
            }

            return nextState
        })
    }

    private convertFinishReason(finishReason: string): 'end_turn' | 'tool_use' | 'max_tokens' {
        switch (finishReason) {
            case 'MAX_TOKENS':
                return 'max_tokens'
            case 'STOP':
                return 'end_turn'
            default:
                return 'end_turn'
        }
    }
}
