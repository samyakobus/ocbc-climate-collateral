/**
 * Setup for the `component` Vitest project (jsdom + Testing Library).
 *
 * Adds the jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, ...) and
 * unmounts every rendered tree between tests so one component test cannot leak
 * DOM into the next.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
