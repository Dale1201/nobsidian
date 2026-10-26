export const PRIVACY_URL =
  'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data'
export const KEYS_URL = 'https://platform.claude.com/settings/keys'
export const CONSOLE_URL = 'https://platform.claude.com/'

export function openExternal(url: string): void {
  void window.api.invoke('shell:openExternal', { url })
}
