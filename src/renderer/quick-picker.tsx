import React from 'react';
import ReactDOM from 'react-dom/client';
import QuickPickerPage from './pages/QuickPickerPage';
import './styles/globals.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure there is a <div id="root"> in quick-picker.html.');
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <QuickPickerPage />
  </React.StrictMode>,
);
