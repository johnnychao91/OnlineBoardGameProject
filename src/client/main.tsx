import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameHeaderProvider } from './game-header-context';
import { SiteFooter } from './SiteFooter';
import { startAnalytics } from './analytics';
import './styles.css';
import './desktop.css';
import './art-style.css';

void startAnalytics();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><GameHeaderProvider><App /><SiteFooter /></GameHeaderProvider></React.StrictMode>,
);
