import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './layout/app-shell';
import '../styles/index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found');
}

createRoot(container).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
);
