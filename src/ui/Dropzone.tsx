import { useCallback, useRef, useState } from 'react';
import { ACCEPT_ATTRIBUTE } from '../media/load.ts';
import { useStudio } from '../state/store.ts';

/** Drop target shown over the canvas until a screen is chosen. */
export function Dropzone(): React.JSX.Element {
  const importFile = useStudio((state) => state.importFile);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void importFile(file);
    },
    [importFile],
  );

  return (
    <div
      className={dragging ? 'dropzone dropzone--active' : 'dropzone'}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      data-testid="dropzone"
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="visually-hidden"
        data-testid="file-input"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <div className="dropzone__inner">
        <svg viewBox="0 0 24 24" className="dropzone__icon" aria-hidden="true">
          <path
            d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="dropzone__title">Drop a screenshot or screen recording</p>
        <p className="dropzone__hint">PNG, JPEG, WebP, MP4, or WebM — nothing leaves your machine</p>
        <button type="button" className="button button--primary" onClick={() => inputRef.current?.click()}>
          Choose a file
        </button>
      </div>
    </div>
  );
}
