import { requireNativeModule } from 'expo-modules-core';

interface CloudflareBypassNativeModule {
  getCookies(url: string): Promise<string>;
  setCookies(url: string, cookies: string): Promise<boolean>;
  clearCookies(): Promise<boolean>;
  getBrowserAuthToken(tokenId: string): Promise<string>;
  getBrowserAuthHosts(tokenId: string): Promise<string>;
  clearBrowserAuthToken(tokenId: string): Promise<boolean>;
  launchBypassActivity(
    url: string,
    title: string,
    tokenId: string,
    authCaptureJson: string,
  ): Promise<boolean>;
}

const NativeModule = requireNativeModule<CloudflareBypassNativeModule>('CloudflareBypass');

/**
 * Get cookies for a URL from Android's native CookieManager.
 * Works with both WebView and our native CloudflareBypassActivity.
 */
export async function getCookies(url: string): Promise<string> {
  return NativeModule.getCookies(url);
}

/**
 * Set cookies for a URL in Android's native CookieManager.
 */
export async function setCookies(url: string, cookies: string): Promise<boolean> {
  return NativeModule.setCookies(url, cookies);
}

/**
 * Clear all cookies from Android's native CookieManager.
 */
export async function clearCookies(): Promise<boolean> {
  return NativeModule.clearCookies();
}

/**
 * Read a login token captured by the native browser for an extension.
 * Values stay in Android private app storage and should never be logged.
 */
export async function getBrowserAuthToken(tokenId: string): Promise<string> {
  return NativeModule.getBrowserAuthToken(tokenId);
}

export async function getBrowserAuthHosts(tokenId: string): Promise<string[]> {
  const value = await NativeModule.getBrowserAuthHosts(tokenId);
  return value.split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
}

export async function clearBrowserAuthToken(tokenId: string): Promise<boolean> {
  return NativeModule.clearBrowserAuthToken(tokenId);
}

/**
 * Launch a pure native Android WebView Activity for Cloudflare bypass.
 *
 * This Activity has NO React Native bridge injected, so Cloudflare Turnstile
 * cannot detect it as an automated environment. After solving the challenge,
 * cf_clearance is stored in Android's CookieManager.
 *
 * Use getCookies(url) after the activity is dismissed to retrieve the cookies.
 */
export async function launchBypassActivity(
  url: string,
  title: string = 'Verification',
  tokenId: string = '',
  authCaptureJson: string = '',
): Promise<boolean> {
  return NativeModule.launchBypassActivity(url, title, tokenId, authCaptureJson);
}
