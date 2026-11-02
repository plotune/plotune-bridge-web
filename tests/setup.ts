import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';
afterEach(() => { try { localStorage.clear(); } catch { /* not available */ } });
