import * as types from './types'
import * as provider from './provider'
import * as utils from './utils'

export class impl implements provider.Provider {
    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const openaiRequest = this.convertToOpenAIRequestBody(claudeRequest)

        const finalUrl = utils.buildUrl(baseUrl, 'chat/completions')

        const headers = new Headers(request.headers)
        headers.set('Authorization', `Bearer ${apiKey}`)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(openaiRequest)
        })
    }

    async convertToClaudeResponse(openaiResponse: Response): Promise<Response> {
        if (!openaiResponse.ok) {
            return openaiResponse
        }

        const contentType = openaiResponse.headers.get('content-type') || ''
        const isStream = contentType.includes('text/event-stream')

        if (isStream) {
            return this.convertStreamResponse(openaiResponse)
        } else {
            return this.convertNormalResponse(openaiResponse)
        }
    }

    private convertToOpenAIRequestBody(claudeRequest: types.ClaudeRequest): types.OpenAIRequest {
        const openaiRequest: types.OpenAIRequest = {
            model: claudeRequest.model,
            messages: this.convertMessages(claudeRequest.messages, claudeRequest.system),
            stream: claudeRequest.stream
        }

        if (claudeRequest.tools && claudeRequest.tools.length > 0) {
            openaiRequest.tools = claudeRequest.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: utils.cleanOpenAIFunctionSchema(tool.input_schema)
                }
            }))
        }

        const toolChoice = this.convertToolChoice(claudeRequest.tool_choice)
        if (toolChoice) {
            openaiRequest.tool_choice = toolChoice
        }

        if (claudeRequest.temperature !== undefined) {
            openaiRequest.temperature = claudeRequest.temperature
        }

        if (claudeRequest.max_tokens !== undefined) {
            openaiRequest.max_completion_tokens = claudeRequest.max_tokens
        }

        if (claudeRequest.stop_sequences !== undefined) {
            openaiRequest.stop = claudeRequest.stop_sequences
        }

        if (claudeRequest.top_p !== undefined) {
            openaiRequest.top_p = claudeRequest.top_p
        }

        return openaiRequest
    }

    private convertToolChoice(toolChoice: types.ClaudeRequest['tool_choice']): any {
        if (!toolChoice) {
            return undefined
        }

        switch (toolChoice.type) {
            case 'auto':
            case 'none':
                return toolChoice.type
            case 'any':
                return 'required'
            case 'tool':
                return {
                    type: 'function',
                    function: {
                        name: toolChoice.name
                    }
                }
        }
    }

    private convertMessages(
        claudeMessages: types.ClaudeMessage[],
        system: types.ClaudeRequest['system']
    ): types.OpenAIMessage[] {
        const openaiMessages: types.OpenAIMessage[] = []

        const systemContent = this.convertSystemContent(system)
        if (systemContent) {
            openaiMessages.push({
                role: 'system',
                content: systemContent
            })
        }

        for (const message of claudeMessages) {
            if (typeof message.content === 'string') {
                openaiMessages.push({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content: message.content
                })
                continue
            }

            const textContents: string[] = []
            const toolCalls: types.OpenAIToolCall[] = []
            const toolResults: Array<{ tool_call_id: string; content: string }> = []

            for (const content of message.content) {
                switch (content.type) {
                    case 'text':
                        textContents.push(content.text)
                        break
                    case 'tool_use':
                        toolCalls.push({
                            id: content.id,
                            type: 'function',
                            function: {
                                name: content.name,
                                arguments: JSON.stringify(content.input)
                            }
                        })
                        break
                    case 'tool_result':
                        toolResults.push({
                            tool_call_id: content.tool_use_id,
                            content:
                                typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
                        })
                        break
                }
            }

            if (textContents.length > 0 || toolCalls.length > 0) {
                const openaiMessage: types.OpenAIMessage = {
                    role: message.role === 'assistant' ? 'assistant' : 'user'
                }

                if (textContents.length > 0) {
                    openaiMessage.content = textContents.join('\n')
                }

                if (toolCalls.length > 0) {
                    openaiMessage.tool_calls = toolCalls
                }

                openaiMessages.push(openaiMessage)
            }

            for (const toolResult of toolResults) {
                openaiMessages.push({
                    role: 'tool',
                    tool_call_id: toolResult.tool_call_id,
                    content: toolResult.content
                })
            }
        }

        return openaiMessages
    }

    private async convertNormalResponse(openaiResponse: Response): Promise<Response> {
        const openaiData = (await openaiResponse.json()) as types.OpenAIResponse

        const claudeResponse: types.ClaudeResponse = {
            id: utils.generateId(),
            type: 'message',
            role: 'assistant',
            content: []
        }

        if (openaiData.choices && openaiData.choices.length > 0) {
            const choice = openaiData.choices[0]
            const message = choice.message

            if (message.content) {
                claudeResponse.content.push({
                    type: 'text',
                    text: message.content
                })
            }

            if (message.tool_calls) {
                for (const toolCall of message.tool_calls) {
                    claudeResponse.content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: this.parseToolArguments(toolCall.function.arguments)
                    })
                }
                claudeResponse.stop_reason = 'tool_use'
            } else if (choice.finish_reason === 'length') {
                claudeResponse.stop_reason = 'max_tokens'
            } else {
                claudeResponse.stop_reason = 'end_turn'
            }
        }

        if (openaiData.usage) {
            claudeResponse.usage = {
                input_tokens: openaiData.usage.prompt_tokens,
                output_tokens: openaiData.usage.completion_tokens
            }
        }

        return new Response(JSON.stringify(claudeResponse), {
            status: openaiResponse.status,
            headers: {
                'Content-Type': 'application/json'
            }
        })
    }

    private convertSystemContent(system: types.ClaudeRequest['system']): string | undefined {
        if (!system) {
            return undefined
        }

        if (typeof system === 'string') {
            return system
        }

        const text = system
            .filter(content => content.type === 'text' && content.text)
            .map(content => content.text)
            .join('\n')

        return text || undefined
    }

    private parseToolArguments(rawArguments: string | undefined): any {
        if (!rawArguments) {
            return {}
        }

        try {
            return JSON.parse(rawArguments)
        } catch {
            return {}
        }
    }

    private async convertStreamResponse(openaiResponse: Response): Promise<Response> {
        return utils.processProviderStream(openaiResponse, (jsonStr, state) => {
            const openaiData = JSON.parse(jsonStr) as types.OpenAIStreamResponse
            if (!openaiData.choices || openaiData.choices.length === 0) {
                return null
            }

            const choice = openaiData.choices[0]
            const delta = choice.delta
            const events: string[] = []
            let nextState: utils.ProviderStreamState = {
                ...state,
                events,
                toolCalls: state.toolCalls || {}
            }

            if (delta.content) {
                if (nextState.openTextBlockIndex === undefined) {
                    nextState.openTextBlockIndex = nextState.textBlockIndex
                    nextState.textBlockIndex++
                    events.push(utils.startTextPart(nextState.openTextBlockIndex))
                }
                events.push(utils.processTextDelta(delta.content, nextState.openTextBlockIndex))
            }

            if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                    const existing = nextState.toolCalls?.[toolCall.index] || { arguments: '' }
                    if (toolCall.id) {
                        existing.id = toolCall.id
                    }
                    if (toolCall.function?.name) {
                        existing.name = toolCall.function.name
                    }
                    if (toolCall.function?.arguments) {
                        existing.arguments += toolCall.function.arguments
                    }
                    nextState.toolCalls![toolCall.index] = existing
                }
            }

            if (choice.finish_reason === 'tool_calls' && nextState.toolCalls) {
                if (nextState.openTextBlockIndex !== undefined) {
                    events.push(utils.stopContentBlock(nextState.openTextBlockIndex))
                    nextState.openTextBlockIndex = undefined
                }

                for (const toolCall of Object.values(nextState.toolCalls)) {
                    if (!toolCall.name) continue

                    events.push(
                        ...utils.processToolUsePart(
                            {
                                id: toolCall.id,
                                name: toolCall.name,
                                args: this.parseToolArguments(toolCall.arguments)
                            },
                            nextState.toolUseBlockIndex
                        )
                    )
                    nextState.toolUseBlockIndex++
                }
                nextState.toolCalls = {}
            }

            if (choice.finish_reason) {
                nextState.stopReason = this.convertFinishReason(choice.finish_reason)
            }

            return nextState
        })
    }

    private convertFinishReason(finishReason: string): 'end_turn' | 'tool_use' | 'max_tokens' {
        switch (finishReason) {
            case 'tool_calls':
                return 'tool_use'
            case 'length':
                return 'max_tokens'
            default:
                return 'end_turn'
        }
    }
}
