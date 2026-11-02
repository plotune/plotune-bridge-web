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

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Icon>
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const IconSidebar = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="2.5" y="3" width="11" height="10" rx="2.2" /><path d="M6.5 3v10" /></Icon>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><circle cx="7" cy="7" r="4" /><path d="m10 10 3.2 3.2" /></Icon>
);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M3 5h6M12 5h1M3 11h1M7 11h6" /><circle cx="10.5" cy="5" r="1.5" /><circle cx="5.5" cy="11" r="1.5" /></Icon>
);
export const IconPower = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M8 2.5v5" /><path d="M4.9 4.6a5 5 0 1 0 6.2 0" /></Icon>
);
export const IconRecord = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.4" fill="currentColor" /></Icon>
);
export const IconDatabase = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><ellipse cx="8" cy="4.5" rx="4.8" ry="1.9" /><path d="M3.2 4.5v7c0 1 2.1 1.9 4.8 1.9s4.8-.9 4.8-1.9v-7M3.2 8c0 1 2.1 1.9 4.8 1.9s4.8-.9 4.8-1.9" /></Icon>
);
export const IconPanelAdd = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="2.4" /><path d="M8 5.6v4.8M5.6 8h4.8" /></Icon>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></Icon>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></Icon>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><circle cx="3.6" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.4" cy="8" r=".9" fill="currentColor" /></Icon>
);
export const IconScope = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 11 5.5 6l2.5 3.5 2-5 3.5 6.5" /></Icon>
);
export const IconAnalyze = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M3 4h10M3 8h10M3 12h10" opacity=".35" /><path d="M2.5 6.5 5 3.8l2 3 2.6-4 3.9 6" /></Icon>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M5.5 3.5v9M10.5 3.5v9" /></Icon>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M8 10.5V3M5 5.8 8 3l3 2.8M3 11.5v1h10v-1" /></Icon>
);
export const IconTrash = IconClear;
export const IconEdit = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="m3 13 .6-2.8 6.6-6.6a1.4 1.4 0 0 1 2 2l-6.6 6.6z" /></Icon>
);
export const IconMinus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M3.2 8h9.6" /></Icon>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M8 3v7.5M5 7.8l3 2.8 3-2.8M3 12.5h10" /></Icon>
);
export const IconReset = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.8v2.4h2.4" /></Icon>
);
export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.8" cy="4" r=".7" fill="currentColor" /><circle cx="2.8" cy="8" r=".7" fill="currentColor" /><circle cx="2.8" cy="12" r=".7" fill="currentColor" /></Icon>
);
export const IconFx = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M6.6 13c.9 0 1.2-.5 1.5-1.7l.9-5.6c.2-1.3.6-1.7 1.6-1.7M5.2 7.5h4.6M10.6 8.6l2.6 3.2M13.2 8.6l-2.6 3.2" /></Icon>
);
export const IconFit = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 5.5V2.5h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" /><path d="M5.5 9.8 7.3 7l1.6 1.8L10.5 6" /></Icon>
);
export const IconStrips = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><rect x="2.5" y="2.8" width="11" height="4" rx="1.2" /><rect x="2.5" y="9.2" width="11" height="4" rx="1.2" /></Icon>
);
export const IconCursors = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M5 2.5v11M11 2.5v11" strokeDasharray="1.6 1.6" /></Icon>
);
export const IconSamples = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 11 6 6l3 3.5 4.5-6" opacity=".45" /><circle cx="6" cy="6" r="1.1" fill="currentColor" /><circle cx="9" cy="9.5" r="1.1" fill="currentColor" /></Icon>
);
export const IconSigma = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M12 3.5H4.5l4 4.5-4 4.5H12" /></Icon>
);
