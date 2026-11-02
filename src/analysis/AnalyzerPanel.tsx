import { Panel } from '../components/Panel';
export function AnalyzerPanel({ pid }: { pid: string }) { return <Panel id="analyzer" title="Analyzer"><p className="bw-empty">Analyzer {pid}</p></Panel>; }
