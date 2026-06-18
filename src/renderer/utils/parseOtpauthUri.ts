import type { TotpConfig } from '../../shared/types';

export interface ParsedOtpauth {
  type: 'totp' | 'hotp';
  label: string;
  account: string;
  issuer: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  counter?: number;
}

/**
 * Parse an otpauth:// URI into a structured TotpConfig object.
 *
 * Supports both otpauth://totp/ and otpauth://hotp/ URIs.
 * Falls back to sensible defaults for missing parameters.
 *
 * @param uri - The otpauth URI string (e.g. "otpauth://totp/Example:user?secret=...")
 * @returns ParsedOtpauth object, or null if the URI is invalid / not otpauth.
 */
export function parseOtpauthUri(uri: string): ParsedOtpauth | null {
  if (!uri || typeof uri !== 'string') return null;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }

  if (url.protocol !== 'otpauth:') return null;

  const type = url.hostname.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') return null;

  const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const [labelPart, accountPart] = path.split(':', 2);
  const label = labelPart || '';
  const account = accountPart || '';

  const secret = url.searchParams.get('secret') || '';
  if (!secret) return null;

  const issuerFromParam = url.searchParams.get('issuer') || '';
  const issuer = issuerFromParam || label;

  const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();

  const digitsRaw = url.searchParams.get('digits');
  const digits = digitsRaw ? parseInt(digitsRaw, 10) : 6;

  const periodRaw = url.searchParams.get('period');
  const period = periodRaw ? parseInt(periodRaw, 10) : 30;

  const counterRaw = url.searchParams.get('counter');
  const counter = counterRaw ? parseInt(counterRaw, 10) : undefined;

  return {
    type: type as 'totp' | 'hotp',
    label,
    issuer,
    account,
    secret,
    algorithm,
    digits: Number.isNaN(digits) ? 6 : digits,
    period: Number.isNaN(period) ? 30 : period,
    counter,
  };
}

/**
 * Convert a ParsedOtpauth result into a TotpConfig usable by the app.
 *
 * @param parsed - The parsed otpauth URI result.
 * @returns A TotpConfig with defaults applied.
 */
export function parsedToTotpConfig(parsed: ParsedOtpauth): TotpConfig {
  return {
    secret: parsed.secret,
    period: parsed.period,
    digits: parsed.digits === 8 ? 8 : 6,
    algorithm: ['SHA1', 'SHA256', 'SHA512'].includes(parsed.algorithm) ? parsed.algorithm : 'SHA1',
  };
}

export interface QrScanResult {
  success: boolean;
  config?: TotpConfig;
  issuer?: string;
  label?: string;
  error?: string;
}

/**
 * Decode a QR code image data URL / blob into a QrScanResult.
 *
 * Steps:
 * 1. Draw the image onto a canvas.
 * 2. Read raw pixel data.
 * 3. Run jsQR on the pixel data.
 * 4. Parse the resulting text as an otpauth:// URI.
 *
 * @param imageSrc - A data URL, blob URL, or any valid Image src.
 * @param jsQR - The jsQR function (imported dynamically to keep bundle lean).
 * @returns QrScanResult with either a TotpConfig or an error key.
 */
export async function decodeQrImage(
  imageSrc: string,
  jsQR: (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null,
): Promise<QrScanResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve({ success: false, error: 'qrScan.errorCanvasContext' });
        return;
      }

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        resolve({ success: false, error: 'qrScan.errorReadImage' });
        return;
      }

      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (!code || !code.data) {
        resolve({ success: false, error: 'qrScan.errorNoQrCode' });
        return;
      }

      const parsed = parseOtpauthUri(code.data);
      if (!parsed) {
        resolve({ success: false, error: 'qrScan.errorInvalidOtpUri' });
        return;
      }

      resolve({
        success: true,
        config: parsedToTotpConfig(parsed),
        issuer: parsed.issuer,
        label: parsed.label,
      });
    };

    img.onerror = () => {
      resolve({ success: false, error: 'qrScan.errorLoadImage' });
    };

    img.src = imageSrc;
  });
}
