import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextAdvertising } from './Advertising';
const target = document.getElementById('privacy-advertising');
if (target) createRoot(target).render(createElement(ContextAdvertising));
