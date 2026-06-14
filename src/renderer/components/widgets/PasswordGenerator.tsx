import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Modal from '../ui/Modal';

interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

interface PasswordGeneratorProps {
  onUsePassword: (password: string) => void;
  onClose: () => void;
}

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const NUMBERS = '23456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?~';
const AMBIGUOUS_CHARS = '0O1lI';

function generatePassword(options: PasswordOptions): string {
  let chars = '';
  if (options.uppercase) chars += UPPERCASE;
  if (options.lowercase) chars += LOWERCASE;
  if (options.numbers) chars += NUMBERS;
  if (options.symbols) chars += SYMBOLS;

  if (options.excludeAmbiguous) {
    for (const char of AMBIGUOUS_CHARS) {
      chars = chars.replace(char, '');
    }
  }

  if (chars.length === 0) {
    chars = LOWERCASE + NUMBERS;
  }

  const arr = new Uint32Array(options.length);
  crypto.getRandomValues(arr);
  let password = '';
  for (let i = 0; i < options.length; i++) {
    password += chars[arr[i] % chars.length];
  }
  return password;
}

function calculateEntropy(password: string): number {
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33;
  if (poolSize === 0) return 0;
  return Math.log2(poolSize) * password.length;
}

function evaluateStrength(password: string): { score: number; label: string; entropy: number } {
  const entropy = calculateEntropy(password);
  const length = password.length;
  let score: number;
  if (length < 6 || entropy < 28) score = 0;
  else if (length < 8 || entropy < 36) score = 1;
  else if (length < 12 || entropy < 60) score = 2;
  else if (length < 16 || entropy < 80) score = 3;
  else score = 4;
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  return { score, label: labels[score], entropy: Math.round(entropy) };
}

const STRENGTH_COLORS = ['bg-danger-500', 'bg-warning-500', 'bg-warning-400', 'bg-success-400', 'bg-success-500'];

export default function PasswordGenerator({
  onUsePassword,
  onClose,
}: PasswordGeneratorProps): React.ReactElement {
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const options: PasswordOptions = useMemo(
    () => ({ length, uppercase, lowercase, numbers, symbols, excludeAmbiguous }),
    [length, uppercase, lowercase, numbers, symbols, excludeAmbiguous],
  );

  const regenerate = useCallback(() => {
    const pw = generatePassword(options);
    setCurrentPassword(pw);
    setHistory((prev) => [pw, ...prev].slice(0, 10));
  }, [options]);

  useEffect(() => {
    regenerate();
  }, []);

  const handleCopy = useCallback(async () => {
    if (!currentPassword) return;
    try {
      await navigator.clipboard.writeText(currentPassword);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(''), 2000);
    } catch {
      // Clipboard not available
    }
  }, [currentPassword]);

  const handleUse = useCallback(() => {
    onUsePassword(currentPassword);
    onClose();
  }, [currentPassword, onUsePassword, onClose]);

  const strength = useMemo(
    () => (currentPassword ? evaluateStrength(currentPassword) : { score: 0, label: '', entropy: 0 }),
    [currentPassword],
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      position="top"
      className="max-w-md"
      ariaLabel="Password Generator"
    >
      <div>
        <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">
            Password Generator
          </h2>
          <button
            className="notion-button-ghost h-7 w-7 p-0"
            onClick={onClose}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Generated password */}
          <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono text-sm text-surface-900 dark:text-surface-50 break-all select-all">
                {currentPassword}
              </span>
              <button
                className="notion-button-ghost h-8 w-8 p-0 shrink-0"
                onClick={regenerate}
                aria-label="Regenerate"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                className="notion-button-ghost h-8 w-8 p-0 shrink-0"
                onClick={handleCopy}
                aria-label="Copy"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
            {copyFeedback && (
              <p className="text-xs text-success-500 mt-1">{copyFeedback}</p>
            )}
          </div>

          {/* Strength + Entropy */}
          {currentPassword && (
            <div className="space-y-1.5">
              <div className="notion-progress-bar">
                <div
                  className={`notion-progress-fill ${STRENGTH_COLORS[strength.score]}`}
                  style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className={`font-medium ${
                  strength.score < 2 ? 'text-danger-500' : strength.score < 3 ? 'text-warning-500' : 'text-success-500'
                }`}>
                  {strength.label}
                </span>
                <span className="text-surface-400">{strength.entropy} bits</span>
              </div>
            </div>
          )}

          {/* Length slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-surface-700 dark:text-surface-300">Length</label>
              <span className="text-sm text-surface-500 dark:text-surface-400">{length}</span>
            </div>
            <input
              type="range"
              min={4}
              max={128}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-surface-200 dark:bg-surface-700 accent-accent-500 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-surface-400">
              <span>4</span>
              <span>128</span>
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2.5">
            {([
              { key: 'uppercase', label: 'A-Z (Uppercase)', value: uppercase, setter: setUppercase },
              { key: 'lowercase', label: 'a-z (Lowercase)', value: lowercase, setter: setLowercase },
              { key: 'numbers', label: '0-9 (Numbers)', value: numbers, setter: setNumbers },
              { key: 'symbols', label: '!@#$% (Symbols)', value: symbols, setter: setSymbols },
              { key: 'excludeAmbiguous', label: 'Exclude ambiguous (0, O, l, 1)', value: excludeAmbiguous, setter: setExcludeAmbiguous },
            ] as const).map(({ key, label, value, setter }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <div
                  className={`flex items-center justify-center h-5 w-5 rounded border-2 transition-colors ${
                    value
                      ? 'bg-accent-500 border-accent-500'
                      : 'border-surface-300 dark:border-surface-600'
                  }`}
                  onClick={() => setter(!value)}
                >
                  {value && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-surface-700 dark:text-surface-300 select-none">{label}</span>
              </label>
            ))}
          </div>

          {/* History */}
          {history.length > 1 && (
            <div className="space-y-1.5">
              <button
                className="flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`h-3.5 w-3.5 transition-transform ${historyOpen ? 'rotate-90' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                History ({history.length})
              </button>
              {historyOpen && (
                <div className="space-y-1 max-h-[120px] overflow-y-auto">
                  {history.map((pw, i) => (
                    <div
                      key={`${pw}-${i}`}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition-colors"
                      onClick={() => {
                        setCurrentPassword(pw);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="flex-1 font-mono text-xs text-surface-600 dark:text-surface-400 truncate">
                        {pw}
                      </span>
                      {i === 0 && (
                        <span className="text-[10px] text-accent-500 font-medium">Current</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 flex items-center justify-between">
          <button
            className="notion-button-ghost h-8 text-xs"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="notion-button-primary h-8 text-xs gap-1.5"
            onClick={handleUse}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Use password
          </button>
        </div>
      </div>
    </Modal>
  );
}
