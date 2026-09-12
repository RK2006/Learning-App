import type { AiProvider } from './contracts';
import { mockProvider } from './mockProvider';
import { httpProvider } from './httpProvider';

/**
 * The swap. One env var decides which model sits behind the whole app.
 *
 *   npm run dev                      -> FastAPI, real model
 *   VITE_API_MODE=mock npm run dev   -> simulated LLM, no backend needed
 *
 * LIVE IS THE DEFAULT, and it did not used to be. The reasoning for defaulting
 * to `mock` was that live mode spends tokens and a seeded mock is reproducible
 * -- both true, and both beside the point once you notice what the default
 * actually did to people. `start_app.sh` boots the backend, exports a key, and
 * then started a frontend that never spoke to it: every lesson, every path and
 * every grade came from the simulator, with only a small "Simulated" chip to
 * say so. The failure mode is not a crash, it is a demo that looks like it is
 * working. That is how a keyword grader kept marking free responses long after
 * the model grader was built and shipped -- the code was live, the app was not
 * pointed at it.
 *
 * Opting IN to the simulator is cheap and explicit. Opting in to the real thing
 * by remembering an env var you were never told about is not, and the cost of
 * forgetting is silently reading synthetic content and believing it.
 *
 * The mock is still fully supported and still seeded: it is what makes an
 * offline demo reproducible and what exercises the wire mapping in the browser.
 * It is now something you ask for.
 */
const mode = import.meta.env.VITE_API_MODE ?? 'live';

export const ai: AiProvider = mode === 'mock' ? mockProvider : httpProvider;

export const isLive = mode !== 'mock';

export * from './contracts';
export { mockProvider, httpProvider };
