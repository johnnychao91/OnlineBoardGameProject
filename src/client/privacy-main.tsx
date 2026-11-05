import { Fragment, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextAdvertising } from './Advertising';
import { SiteFooter } from './SiteFooter';
import { startAnalytics } from './analytics';
void startAnalytics();
const target = document.getElementById('privacy-advertising');
if (target) createRoot(target).render(createElement(Fragment, null, createElement(ContextAdvertising), createElement(SiteFooter)));
