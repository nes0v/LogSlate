// Minimal type declarations for Google Identity Services (GIS) — just the parts we use.

export {}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: unknown) => void
            prompt?: string
          }): TokenClient
          revoke(accessToken: string, done: () => void): void
          hasGrantedAllScopes(tokenResponse: TokenResponse, ...scopes: string[]): boolean
        }
      }
    }
  }

  interface TokenResponse {
    access_token?: string
    expires_in?: string | number
    scope?: string
    token_type?: string
    error?: string
  }

  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: string }): void
  }
}
