import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconExitFullscreen, IconFullscreen, IconMaximize, IconRestore } from './icons';

export interface PanelProps {
  id: string;
  title: string;
  /** Small status text or badge next to the title. */
  status?: ReactNode;
  /** Extra header buttons, shown before the window controls. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A dashboard panel that can fill the workspace (maximize) or the whole screen (full screen). BR-CAN-WEB-004. */
export function Panel({ id, title, status, actions, className = '', children }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = typeof document !== 'undefined' && typeof document.fullscreenEnabled === 'boolean' && document.fullscreenEnabled;

  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMaximized(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [maximized]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.();
  }, []);

  return (
    <>
      {maximized && <div className="bw-panel-backdrop" onClick={() => setMaximized(false)} />}
      <section ref={ref} id={`panel-${id}`} className={`bw-panel ${maximized ? 'is-maximized' : ''} ${fullscreen ? 'is-fullscreen' : ''} ${className}`} aria-label={title}>
        <header className="bw-panel-head">
          <h2>{title}</h2>
          {status && <span className="bw-panel-status">{status}</span>}
          <div className="bw-panel-tools">
            {actions}
            <button type="button" className="bw-icon-button" onClick={() => setMaximized((m) => !m)} aria-pressed={maximized} aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`} title={maximized ? 'Restore (Esc)' : 'Maximize'}>
              {maximized ? <IconRestore /> : <IconMaximize />}
            </button>
            {canFullscreen && (
              <button type="button" className="bw-icon-button" onClick={toggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? `Exit full screen for ${title}` : `Show ${title} full screen`} title={fullscreen ? 'Exit full screen' : 'Full screen'}>
                {fullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
              </button>
            )}
          </div>
        </header>
        <div className="bw-panel-body">{children}</div>
      </section>
    </>
  );
}
