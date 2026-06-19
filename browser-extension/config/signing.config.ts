/**
 * Signing configuration for SecurePass Manager Browser Extension.
 *
 * IMPORTANT: Do NOT commit secrets to version control.
 * Copy this file to signing.config.local.ts and add your actual credentials there.
 * signing.config.local.ts is already in .gitignore.
 */

export interface FirefoxSigningConfig {
  /** Mozilla AMO API key from https://addons.mozilla.org/en-US/developers/addon/api/ */
  apiKey: string;
  /** Mozilla AMO API secret */
  apiSecret: string;
  /** Firefox extension ID (from manifest or AMO) */
  extensionId: string;
  /** Channel: listed or unlisted */
  channel: 'listed' | 'unlisted';
}

export interface EdgeSigningConfig {
  /** Microsoft Edge Partner Center API client ID */
  clientId: string;
  /** Microsoft Edge Partner Center API client secret */
  clientSecret: string;
  /** Microsoft Edge Partner Center access token URL */
  accessTokenUrl: string;
}

export interface ChromeSigningConfig {
  /** Chrome Web Store API client ID (OAuth 2.0) */
  clientId: string;
  /** Chrome Web Store API client secret */
  clientSecret: string;
  /** Chrome Web Store refresh token */
  refreshToken: string;
  /** Chrome Web Store extension ID */
  extensionId: string;
}

export interface SigningConfig {
  firefox: FirefoxSigningConfig;
  edge: EdgeSigningConfig;
  chrome: ChromeSigningConfig;
}

const defaultSigningConfig: SigningConfig = {
  firefox: {
    apiKey: process.env.FIREFOX_API_KEY || '',
    apiSecret: process.env.FIREFOX_API_SECRET || '',
    extensionId: 'securepass-manager@securepass-manager.org',
    channel: 'listed',
  },
  edge: {
    clientId: process.env.EDGE_CLIENT_ID || '',
    clientSecret: process.env.EDGE_CLIENT_SECRET || '',
    accessTokenUrl:
      process.env.EDGE_ACCESS_TOKEN_URL ||
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  },
  chrome: {
    clientId: process.env.CHROME_CLIENT_ID || '',
    clientSecret: process.env.CHROME_CLIENT_SECRET || '',
    refreshToken: process.env.CHROME_REFRESH_TOKEN || '',
    extensionId: process.env.CHROME_EXTENSION_ID || '',
  },
};

export default defaultSigningConfig;
