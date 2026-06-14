import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './pages/App';
import './styles/globals.css';
import './styles/notion-theme.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[SecurePass] Uncaught error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-surface-50 dark:bg-surface-900 p-8">
          <div className="w-full max-w-lg rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-8 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-danger-50 text-danger-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
                  Something went wrong
                </h1>
                <p className="text-sm text-surface-500 dark:text-surface-400">
                  SecurePass encountered an unexpected error
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-lg bg-surface-50 dark:bg-surface-900 p-4">
              <p className="mb-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                Error:
              </p>
              <p className="text-sm text-surface-600 dark:text-surface-400 font-mono break-all">
                {error?.message || 'Unknown error'}
              </p>
              {errorInfo?.componentStack && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300">
                    Component stack
                  </summary>
                  <pre className="mt-2 text-xs text-surface-500 dark:text-surface-400 overflow-x-auto whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="notion-button-ghost"
              >
                Try again
              </button>
              <button
                onClick={this.handleReload}
                className="notion-button-primary"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure there is a <div id="root"> in index.html.');
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
