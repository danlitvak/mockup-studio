import { useEffect } from 'react';
import { getDevice } from '../core/devices.ts';
import { useStudio } from '../state/store.ts';

const formatDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Every project stored on this device. */
export function Library({ onClose }: { onClose: () => void }): React.JSX.Element {
  const library = useStudio((state) => state.library);
  const currentId = useStudio((state) => state.project.id);
  const openProject = useStudio((state) => state.openProject);
  const removeProject = useStudio((state) => state.removeProject);
  const refreshLibrary = useStudio((state) => state.refreshLibrary);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Projects" data-testid="library">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Projects on this device</h2>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {library.length === 0 ? (
          <p className="panel__empty">Nothing saved yet.</p>
        ) : (
          <ul className="library">
            {library.map((project) => (
              <li
                key={project.id}
                className={project.id === currentId ? 'library__item is-active' : 'library__item'}
              >
                <button
                  type="button"
                  className="library__open"
                  onClick={() => {
                    void openProject(project.id);
                    onClose();
                  }}
                >
                  <span className="library__name">{project.name}</span>
                  <span className="library__meta">
                    {getDevice(project.scene.device).label} · {project.output.aspect} ·{' '}
                    {formatDate(project.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  aria-label={`Delete ${project.name}`}
                  onClick={() => void removeProject(project.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
