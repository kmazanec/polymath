import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App.js';
import { SessionReport } from './views/SessionReport.js';
import { MetricsDashboard } from './MetricsDashboard.js';
import { TutorHandoff } from './views/TutorHandoff.js';
import { TeacherReport } from './views/TeacherReport.js';
// The single global stylesheet (tokens + a11y primitives), imported ONCE here so
// every view inherits the design tokens and the focus/reduced-motion rules.
import './styles/global.css';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  // I5 — operator views.
  { path: '/session/:id/report', element: <SessionReport /> },
  { path: '/metrics', element: <MetricsDashboard /> },
  // ADR-012 stretch (I6): the tutor-handoff artifact. `/handoff/:sessionId` is the
  // learner's own; `/handoff/:sessionId/:token` is a shared link (the random token
  // authenticates the API read).
  { path: '/handoff/:sessionId', element: <TutorHandoff /> },
  { path: '/handoff/:sessionId/:token', element: <TutorHandoff /> },
  { path: '/teacher/:sessionId', element: <TeacherReport /> },
]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
