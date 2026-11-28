import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadFonts } from '@/overlay/fonts';
import { Popup } from './Popup';
import './popup.css';

loadFonts();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
