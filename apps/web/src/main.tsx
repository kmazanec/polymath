import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App.js';
import { SessionReport } from './views/SessionReport.js';
import { MetricsDashboard } from './MetricsDashboard.js';
// The single global stylesheet (tokens + a11y primitives), imported ONCE here so
// every view inherits the design tokens and the focus/reduced-motion rules.
import './styles/global.css';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/session/:id/report', element: <SessionReport /> },
  { path: '/metrics', element: <MetricsDashboard /> },
]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
