import React, { useState, useCallback } from 'react';
import { useExtensionStatus } from '../../hooks/useExtensionStatus';

interface ExtensionSetupWizardProps {
  onComplete?: () => void;
  onSkip?: () => void;
}

export default function ExtensionSetupWizard({ onComplete, onSkip }: ExtensionSetupWizardProps): React.ReactElement {
  const { status, isLoading, install, openStore } = useExtensionStatus();
  const [step, setStep] = useState(0);
  const [installing, setInstalling] = useState(false);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await install();
      setStep(2);
    } finally {
      setInstalling(false);
    }
  }, [install]);

  const handleOpenChrome = useCallback(async () => {
    await openStore('chrome');
  }, [openStore]);

  const handleOpenFirefox = useCallback(async () => {
    await openStore('firefox');
  }, [openStore]);

  const handleComplete = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl dark:bg-surface-800">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-100 dark:bg-accent-900/30">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-accent-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white">Browser Extension Setup</h2>
          <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
            Connect SecurePass to your browser for seamless autofill and quick access.
          </p>
        </div>

        {/* Steps */}
        <div className="mb-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-900/50">
                <h3 className="mb-2 text-sm font-semibold text-surface-800 dark:text-surface-200">What you'll get:</h3>
                <ul className="space-y-2 text-sm text-surface-600 dark:text-surface-300">
                  <li className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-success-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Auto-fill login forms on any website
                  </li>
                  <li className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-success-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Quick access with global keyboard shortcuts
                  </li>
                  <li className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-success-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Secure clipboard with auto-clear
                  </li>
                </ul>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-surface-600 dark:text-surface-300">
                SecurePass needs to install a small Native Messaging Host so the browser extension can communicate with the desktop app securely.
              </p>
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-900/50">
                <h4 className="mb-2 text-sm font-semibold text-surface-800 dark:text-surface-200">Installation Status:</h4>
                {isLoading ? (
                  <p className="text-sm text-surface-400">Checking...</p>
                ) : (
                  <div className="space-y-2">
                    {status &&
                      Object.entries(status.browsers).map(([browser, browserStatus]) => (
                        <div key={browser} className="flex items-center justify-between">
                          <span className="text-sm capitalize text-surface-700 dark:text-surface-300">{browser}</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              browserStatus.registered
                                ? 'bg-success-100 text-success-700 dark:bg-success-900/20'
                                : 'bg-surface-100 text-surface-500 dark:bg-surface-800'
                            }`}
                          >
                            {browserStatus.registered ? 'Installed' : 'Not installed'}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-100 text-success-600 dark:bg-success-900/20">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Setup Complete!</h3>
              <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
                The native messaging host is installed. Now download the extension for your browser:
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button onClick={handleOpenChrome} className="notion-button-ghost h-8 text-xs">
                  Chrome Web Store
                </button>
                <button onClick={handleOpenFirefox} className="notion-button-ghost h-8 text-xs">
                  Firefox Add-ons
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-surface-200 pt-4 dark:border-surface-700">
          {step < 2 ? (
            <>
              <button onClick={onSkip} className="text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200">
                Skip for now
              </button>
              <div className="flex gap-2">
                {step > 0 && (
                  <button onClick={() => setStep(0)} className="notion-button-ghost h-8 text-xs">
                    Back
                  </button>
                )}
                {step === 0 ? (
                  <button onClick={() => setStep(1)} className="notion-button-primary h-8 text-xs">
                    Next
                  </button>
                ) : (
                  <button onClick={handleInstall} disabled={installing} className="notion-button-primary h-8 text-xs disabled:opacity-50">
                    {installing ? 'Installing...' : 'Install Native Host'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <button onClick={handleComplete} className="notion-button-primary h-8 w-full text-xs">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
