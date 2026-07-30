import { useEffect } from 'react';
import { useStudio } from './state/store.ts';
import { Header } from './ui/Header.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { Preview } from './ui/Preview.tsx';
import { Timeline } from './ui/Timeline.tsx';

export default function App(): React.JSX.Element {
  const hydrate = useStudio((state) => state.hydrate);
  const hydrated = useStudio((state) => state.hydrated);
  const notice = useStudio((state) => state.notice);
  const dismiss = useStudio((state) => state.notify);
  const setPlaying = useStudio((state) => state.setPlaying);
  const importFile = useStudio((state) => state.importFile);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Space toggles playback, the way every other editor does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setPlaying(!useStudio.getState().playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPlaying]);

  // Dropping a file anywhere in the window imports it.
  useEffect(() => {
    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      void importFile(file);
    };
    const onDragOver = (event: DragEvent) => event.preventDefault();
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, [importFile]);

  return (
    <div className="app" data-hydrated={hydrated}>
      <Header />
      <main className="workspace">
        <div className="workspace__stage">
          <Preview />
          <Timeline />
        </div>
        <aside className="workspace__inspector">
          <Inspector />
        </aside>
      </main>

      {notice && (
        <div
          className={notice.kind === 'error' ? 'toast toast--error' : 'toast'}
          role="status"
          data-testid="toast"
        >
          <span>{notice.message}</span>
          <button type="button" className="button button--ghost" onClick={() => dismiss(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
