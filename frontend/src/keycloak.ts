import Keycloak from 'keycloak-js'

const url = import.meta.env.VITE_KEYCLOAK_URL
const realm = import.meta.env.VITE_KEYCLOAK_REALM
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID

export const keycloakConfigured = Boolean(url && realm && clientId)
export const keycloak = keycloakConfigured ? new Keycloak({ url, realm, clientId }) : null

export type KeycloakAccount = { token: string; displayName: string; email: string }

export async function initializeKeycloak(): Promise<KeycloakAccount | null> {
  if (!keycloak) return null
  const authenticated = await keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
  if (!authenticated || !keycloak.token) return null
  const profile = keycloak.tokenParsed
  return { token: keycloak.token, displayName: profile?.name ?? profile?.preferred_username ?? 'Learner', email: profile?.email ?? '' }
}

export function loginWithKeycloak(register = false) {
  if (!keycloak) throw new Error('Keycloak has not been configured.')
  return register ? keycloak.register({ redirectUri: window.location.origin }) : keycloak.login({ redirectUri: window.location.origin })
}
