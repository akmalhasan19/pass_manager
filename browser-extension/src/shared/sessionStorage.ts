const SESSION_TOKEN_KEY = 'sessionToken';
const SESSION_ID_KEY = 'sessionId';

export async function setSessionItem(key: string, value: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (error) {
    console.warn('[SecurePass] Failed to write to chrome.storage.session:', error);
  }
}

export async function getSessionItem(key: string): Promise<string | undefined> {
  try {
    const result = await chrome.storage.session.get(key);
    return result[key] as string | undefined;
  } catch (error) {
    console.warn('[SecurePass] Failed to read from chrome.storage.session:', error);
    return undefined;
  }
}

export async function removeSessionItem(key: string): Promise<void> {
  try {
    await chrome.storage.session.remove(key);
  } catch (error) {
    console.warn('[SecurePass] Failed to remove from chrome.storage.session:', error);
  }
}

export async function clearAllSessionData(): Promise<void> {
  try {
    await chrome.storage.session.clear();
  } catch (error) {
    console.warn('[SecurePass] Failed to clear chrome.storage.session:', error);
  }
}

export async function setSessionCredentials(
  sessionToken: string,
  sessionId: string,
): Promise<void> {
  await setSessionItem(SESSION_TOKEN_KEY, sessionToken);
  await setSessionItem(SESSION_ID_KEY, sessionId);
}

export async function getSessionCredentials(): Promise<{
  sessionToken?: string;
  sessionId?: string;
}> {
  const [sessionToken, sessionId] = await Promise.all([
    getSessionItem(SESSION_TOKEN_KEY),
    getSessionItem(SESSION_ID_KEY),
  ]);
  return { sessionToken, sessionId };
}

export async function clearSessionCredentials(): Promise<void> {
  await Promise.all([
    removeSessionItem(SESSION_TOKEN_KEY),
    removeSessionItem(SESSION_ID_KEY),
  ]);
}
