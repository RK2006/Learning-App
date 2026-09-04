import type { AiProvider } from './contracts';
import { mockProvider } from './mockProvider';
import { httpProvider } from './httpProvider';

/**
 * The swap. One env var decides which model sits behind the whole app.
 *
 *   npm run dev                      -> simulated LLM, no backend needed
 *   VITE_API_MODE=live npm run dev   -> FastAPI
 */
const mode = import.meta.env.VITE_API_MODE ?? 'mock';

export const ai: AiProvider = mode === 'live' ? httpProvider : mockProvider;

export const isLive = mode === 'live';

export * from './contracts';
export { mockProvider, httpProvider };
