import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-500.css';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHub } from './createStore';
import { detectBrowser } from './lib/browser';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App hub={createHub()} browser={detectBrowser()} />
  </StrictMode>,
);
