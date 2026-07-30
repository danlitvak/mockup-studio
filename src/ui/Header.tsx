import { useState } from 'react';
import { useStudio } from '../state/store.ts';
import { Library } from './Library.tsx';

export function Header(): React.JSX.Element {
  const name = useStudio((state) => state.project.name);
  const theme = useStudio((state) => state.theme);
  const rename = useStudio((state) => state.rename);
  const setTheme = useStudio((state) => state.setTheme);
  const newProject = useStudio((state) => state.newProject);
  const [libraryOpen, setLibraryOpen] = useState(false);

  return (
    <header className="header">
      <div className="header__brand">
        <svg viewBox="0 0 32 32" className="header__logo" aria-hidden="true">
          <rect x="6" y="3" width="20" height="26" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 11.5v9l7.5-4.5z" fill="currentColor" />
        </svg>
        <span className="header__name">Mockup Studio</span>
        <span className="badge" title="Everything runs and is stored on this device">
          local-first
        </span>
      </div>

      <input
        className="header__title"
        value={name}
        aria-label="Project name"
        data-testid="project-name"
        onChange={(event) => rename(event.target.value)}
      />

      <div className="header__actions">
        <button
          type="button"
          className="button"
          data-testid="new-project"
          onClick={() => void newProject()}
        >
          New
        </button>
        <button
          type="button"
          className="button"
          data-testid="open-library"
          onClick={() => setLibraryOpen(true)}
        >
          Projects
        </button>
        <button
          type="button"
          className="button button--icon"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          data-testid="theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" fill="currentColor" />
              <path
                d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>
      </div>

      {libraryOpen && <Library onClose={() => setLibraryOpen(false)} />}
    </header>
  );
}
