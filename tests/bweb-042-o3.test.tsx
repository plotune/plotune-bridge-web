// BWEB-042 rev 1 / O3 (WCAG 3.3.1 Error Identification, 4.1.3 Status Messages).
// A failed open/connect produces an `alert`, but focus used to stay on body or the pane title.
// These L2 tests pin the focus behaviour and the anti-focus-stealing guards; e2e/bweb-042-o3.spec.ts
// proves it in a real browser.
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoticeCard } from '../src/components/Notice';
import type { Notice } from '../src/transport/notices';

afterEach(cleanup);

const error: Notice = {
  kind: 'unreachable', severity: 'error', title: "Couldn't connect to the device",
  summary: 'The browser does not say why a connection fails.', steps: ['Check the address.'], technical: 'close code: 1006',
};
const info: Notice = {
  kind: 'ended', severity: 'info', title: 'Disconnected', summary: 'You disconnected.', steps: [], technical: '',
};

/** The F7 behaviour from the real add-device pane: a title that takes focus when the trigger is gone. */
function PaneTitle({ notice }: { notice: Notice | null }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) titleRef.current?.focus();
  }, []);
  return (
    <section className="bw-add-device">
      <h1 ref={titleRef} tabIndex={-1}>Sign in to connect your Bridge</h1>
      {notice && <NoticeCard notice={notice} actions={<button type="button">Change address</button>} />}
    </section>
  );
}

describe('BWEB-042 r1 / O3: focus lands on the failure notice', () => {
  it('an error notice is an alert, is programmatically focusable, and takes focus', () => {
    render(<NoticeCard notice={error} actions={<button type="button">Change address</button>} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('tabindex', '-1');
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("Couldn't connect to the device");
  });

  it('an informational notice stays passive: no tabindex, no focus theft', () => {
    const view = (notice: Notice | null) => (
      <div>
        <button type="button">Elsewhere</button>
        {notice && <NoticeCard notice={notice} />}
      </div>
    );
    const { rerender } = render(view(null));
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    expect(elsewhere).toHaveFocus();
    rerender(view(info));
    const status = screen.getByRole('status');
    expect(status).not.toHaveAttribute('tabindex');
    expect(elsewhere).toHaveFocus(); // an info notice must never steal focus
  });

  it('when a pane title and an error notice appear together, the notice wins (instead of the pane title)', () => {
    render(<PaneTitle notice={error} />);
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).not.toHaveFocus();
  });

  it('a title that already has focus gives way when a failure notice appears later', () => {
    const { rerender } = render(<PaneTitle notice={null} />);
    const title = screen.getByRole('heading', { name: 'Sign in to connect your Bridge' });
    expect(title).toHaveFocus(); // F7: focus fell to the pane title
    rerender(<PaneTitle notice={error} />);
    expect(screen.getByRole('alert')).toHaveFocus(); // O3: the failure takes over
    expect(title).not.toHaveFocus();
  });
});

describe('BWEB-042 r1 / O3: focus is not stolen from the user', () => {
  it('a re-render with a fresh but identical notice object does not yank focus back', () => {
    const actions = <button type="button">Change address</button>;
    const { rerender } = render(<NoticeCard notice={error} actions={actions} />);
    expect(screen.getByRole('alert')).toHaveFocus();
    const change = screen.getByRole('button', { name: 'Change address' });
    change.focus(); // the user moved on to a recovery action
    expect(change).toHaveFocus();
    rerender(<NoticeCard notice={{ ...error }} actions={actions} />); // new object, same failure
    expect(change).toHaveFocus();
    expect(screen.getByRole('alert')).not.toHaveFocus();
  });

  it('an error notice appearing while the user types in another panel leaves that field focused', () => {
    const view = (notice: Notice | null) => (
      <div>
        <input aria-label="Filter" defaultValue="7E8" />
        {notice && <NoticeCard notice={notice} />}
      </div>
    );
    const { rerender } = render(view(null));
    const input = screen.getByLabelText('Filter');
    input.focus();
    rerender(view(error));
    expect(input).toHaveFocus();
    expect(screen.getByRole('alert')).not.toHaveFocus();
  });
});
