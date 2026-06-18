/**
 * Native Messaging Host Module
 *
 * Provides the native messaging host manifest generation, platform-specific
 * registration, and installation/uninstallation orchestration for the
 * SecurePass Manager Electron app.
 *
 * @module native-host
 */

export {
  NATIVE_HOST_NAME,
  NATIVE_HOST_DESCRIPTION,
  NATIVE_HOST_TYPE,
  CHROME_EXTENSION_PREFIX,
  FIREFOX_EXTENSION_PREFIX,
  EDGE_EXTENSION_PREFIX,
  generateManifest,
  normalizeExtensionOrigin,
  getManifestDirectory,
  getManifestPath,
  getHostExecutablePath,
  manifestExistsAt,
  serializeManifest,
  validateManifest,
  type NativeHostManifest,
  type BrowserId,
  type PlatformId,
  type ManifestOptions,
} from './manifest';

export {
  getRegistryKeyPath,
  writeManifestFile,
  readManifestFile,
  removeManifestFile,
  setRegistryKey,
  removeRegistryKey,
  registryKeyExists,
  registerHost,
  unregisterHost,
  isHostRegistered,
  type RegistrationResult,
} from './registration';

export {
  SUPPORTED_BROWSERS,
  installNativeHost,
  uninstallNativeHost,
  getNativeHostStatus,
  checkHostAvailability,
  type InstallOptions,
  type InstallResult,
  type UninstallResult,
} from './installer';
