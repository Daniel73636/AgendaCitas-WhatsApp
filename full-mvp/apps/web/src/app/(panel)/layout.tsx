import { PanelShell } from '@/components/panel/panel-shell';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
