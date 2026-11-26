"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
export const THEME_STORAGE_KEY = "infrapilot-theme";

/**
 * Applies the theme choice to <html>. The initial value is written by the inline
 * bootstrap script in the root layout before first paint, which is why this
 * provider reads the resolved class instead of re-deriving the preference. That
 * keeps the two in sync and avoids a flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — the theme still applies for this session */
    }
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
