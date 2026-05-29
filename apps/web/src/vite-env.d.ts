/// <reference types="vite/client" />

/**
 * Build-time environment the client reads via `import.meta.env`. The PostHog vars are
 * OPTIONAL — absent/blank means analytics are not configured and the wiring fails
 * closed (a clean no-op), so they are typed `string | undefined`. Vite inlines these
 * at BUILD time, so the deployed bundle only carries a key if it was passed as a build
 * ARG (see apps/web/Dockerfile).
 */
interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
