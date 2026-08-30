/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' (default) drives the UI from the simulated LLM provider; 'live' calls the FastAPI backend. */
  readonly VITE_API_MODE?: 'mock' | 'live';
  /** Base URL for the FastAPI backend when VITE_API_MODE is 'live'. */
  readonly VITE_API_BASE_URL?: string;
  /** 0..1. Fraction of mock requests that fail, for exercising error states. */
  readonly VITE_MOCK_FAIL_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
