import React from 'react';
import ReactDOM from 'react-dom/client';

// Self-hosted variable fonts. Explicitly NOT Inter: its design brief is to be
// invisible, which is a fair description of a UI where no typographic decision
// was made.
//
// Import the /opsz builds specifically, NOT the package root. The default entry
// ships wght-only files, against which the `font-variation-settings: 'opsz'` in
// base.css silently does nothing -- headings would scale one master instead of
// setting their own optical size. Subsetting still happens at runtime via
// unicode-range, so the extra emitted files are never fetched for Latin text.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/source-serif-4/opsz.css';

// Order matters: tokens define the custom properties everything else reads.
import './styles/tokens.css';
import './styles/reset.css';
import './styles/base.css';
import './styles/keyframes.css';

import App from './App';
import { initTheme } from './lib/theme';

// Before first render, so there is no flash of the wrong theme.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
