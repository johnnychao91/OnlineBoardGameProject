import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializeVisualStyle } from './visual-style';
import './styles.css';
import './desktop.css';
import './art-style.css';

initializeVisualStyle();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
