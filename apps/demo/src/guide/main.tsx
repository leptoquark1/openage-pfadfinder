import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { GuideApp } from './GuideApp.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuideApp />
  </StrictMode>,
);
