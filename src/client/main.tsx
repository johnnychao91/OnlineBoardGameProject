import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameHeaderProvider } from './game-header-context';
import './styles.css';
import './desktop.css';
import './art-style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><GameHeaderProvider><App /></GameHeaderProvider></React.StrictMode>,
);
