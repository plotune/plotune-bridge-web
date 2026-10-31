// The account control at the right of the top bar: a Sign in button, a disabled "Signing in…" while a redirect or exchange
// runs, and once signed in a username button that opens a small menu (Switch account, Sign out, manage on plotune.net).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useCloud } from '../cloud/context';

const PROFILE_URL = 'https://www.plotune.net/profile';

function focusItem(menu: HTMLElement | null, direction: 1 | -1 | 'first'): void {
  if (menu === null) return;
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (items.length === 0) return;
  if (direction === 'first') {
    items[0].focus();
    return;
  }
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = (current + direction + items.length) % items.length;
  items[next].focus();
}

export function AccountMenu() {
  const { status, username, startSignIn, signOut } = useCloud();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu only exists while signed in; a stale "open" flag must not reopen it on the next sign-in.
  const menuOpen = open && status === 'signed-in';

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) focusItem(menuRef.current, 'first');
  }, [menuOpen]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(menuRef.current, event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  if (status === 'signed-out') {
    return (
      <button type="button" className="bw-button bw-small bw-topbar-account-button" onClick={() => void startSignIn()}>
        Sign in
      </button>
    );
  }

  if (status === 'signing-in') {
    return (
      <button type="button" className="bw-button bw-small bw-topbar-account-button" disabled aria-busy="true">
        Signing in…
      </button>
    );
  }

  const who = username ?? 'Plotune account';
  return (
    <div className="bw-account-menu" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="bw-button bw-small bw-topbar-account-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? 'account-menu-list' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {who}
      </button>
      {menuOpen && (
        <div className="bw-account-menu-body">
          <p className="bw-account-menu-who">Signed in as {who}</p>
          <div id="account-menu-list" ref={menuRef} role="menu" aria-label="Account">
            <button
              type="button"
              role="menuitem"
              className="bw-account-menu-item"
              onClick={() => {
                setOpen(false);
                void startSignIn('login');
              }}
            >
              Switch account
            </button>
            <button
              type="button"
              role="menuitem"
              className="bw-account-menu-item"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
            >
              Sign out
            </button>
            <a role="menuitem" className="bw-account-menu-item" href={PROFILE_URL} target="_blank" rel="noopener noreferrer">
              Manage account on plotune.net
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
