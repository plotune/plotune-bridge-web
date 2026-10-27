// Original line icons for the Bridge workspace, drawn for this product (16px grid, 1.6 stroke).
import type { SVGProps } from 'react';

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

export const IconStart = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M5 3.2v9.6l7.5-4.8z" fill="currentColor" /></Icon>
);
export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" /></Icon>
);
export const IconClear = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M3 5h10M6 5V3.5h4V5M4.5 5l.6 7.5h5.8l.6-7.5" /></Icon>
);
export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 8h9M8.5 4.5 12 8l-3.5 3.5" /></Icon>
);
export const IconMaximize = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="3" y="3" width="10" height="10" rx="1" /><path d="M3 6h10" /></Icon>
);
export const IconRestore = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="3" y="5.5" width="7.5" height="7.5" rx="1" /><path d="M6 5.5V3h7v7h-2.5" /></Icon>
);
export const IconFullscreen = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Icon>
);
export const IconExitFullscreen = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" /></Icon>
);
export const IconPanels = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="11" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></Icon>
);
export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><circle cx="4.5" cy="8" r="2" /><circle cx="11.5" cy="8" r="2" /><path d="M6.5 8h3" /></Icon>
);
export const IconTrace = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></Icon>
);
export const IconDiagnose = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 8h2.5l1.5-4 3 8 1.5-4h2.5" /></Icon>
);
export const IconDevice = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="2.5" y="4.5" width="11" height="7" rx="1.2" /><circle cx="5.5" cy="8" r=".6" fill="currentColor" /></Icon>
);
export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.2v.1" /></Icon>
);
export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 7.2v3.5M8 5.2v.1" /></Icon>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="m3.5 8.5 3 3 6-7" /></Icon>
);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></Icon>
);
