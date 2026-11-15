import React from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled so the app renders the same with no internet.
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/500.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
