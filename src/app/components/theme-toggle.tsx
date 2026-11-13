'use client';

import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';

/** Switches between light and dark and remembers the choice. */
export function ThemeToggle() {
  function toggle() {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Switch light or dark theme">
      <Sun className="hidden dark:block" aria-hidden />
      <Moon className="dark:hidden" aria-hidden />
    </Button>
  );
}
