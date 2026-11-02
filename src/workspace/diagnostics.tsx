// One diagnostic link for the selected device, shared by the three diagnostics panels wherever they are docked.
import { createContext, useContext, type ReactNode } from 'react';
import { useDiagnostics } from '../components/pages';

type Diag = ReturnType<typeof useDiagnostics>;
const Ctx = createContext<Diag | null>(null);

export function DiagnosticsProvider({ children }: { children: ReactNode }) {
  const diag = useDiagnostics();
  return <Ctx.Provider value={diag}>{children}</Ctx.Provider>;
}
export function useDiag(): Diag {
  const d = useContext(Ctx);
  if (!d) throw new Error('DiagnosticsProvider is missing');
  return d;
}
