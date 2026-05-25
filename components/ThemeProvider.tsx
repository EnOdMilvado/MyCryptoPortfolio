"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeName = "slate" | "ocean" | "sunset" | "forest";
export const THEME_NAMES: ThemeName[] = ["slate", "ocean", "sunset", "forest"];
export const THEME_STORAGE_KEY = "crypto-theme";
export const DARK_STORAGE_KEY = "crypto-dark";
const DEFAULT_THEME: ThemeName = "slate";

type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  dark: boolean;
  toggleDark: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClass(theme: ThemeName) {
  const root = document.documentElement;
  THEME_NAMES.forEach((t) => root.classList.remove(`theme-${t}`));
  root.classList.add(`theme-${theme}`);
}

function applyDarkClass(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [dark, setDarkState] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeName | null;
    const initialTheme =
      storedTheme && THEME_NAMES.includes(storedTheme) ? storedTheme : DEFAULT_THEME;
    setThemeState(initialTheme);
    applyThemeClass(initialTheme);

    const storedDark = window.localStorage.getItem(DARK_STORAGE_KEY);
    const initialDark =
      storedDark === "1"
        ? true
        : storedDark === "0"
          ? false
          : window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    setDarkState(initialDark);
    applyDarkClass(initialDark);
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    applyThemeClass(t);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {}
  }, []);

  const toggleDark = useCallback(() => {
    setDarkState((prev) => {
      const next = !prev;
      applyDarkClass(next);
      try {
        window.localStorage.setItem(DARK_STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, dark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
