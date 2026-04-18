import * as provider from './provider'
import * as utils from './utils'

export class impl implements provider.Provider {
    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const body = await request.text()
        const finalUrl = utils.buildUrl(baseUrl, 'messages')

        const headers = new Headers(request.headers)
        headers.set('x-api-key', apiKey)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body
        })
    }

    async convertToClaudeResponse(providerResponse: Response): Promise<Response> {
        return providerResponse
    }
}
