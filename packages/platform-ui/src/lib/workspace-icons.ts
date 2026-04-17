import {
  Activity,
  Atom,
  BarChart2,
  Brain,
  Briefcase,
  Building2,
  ClipboardList,
  Database,
  Dna,
  FlaskConical,
  Globe,
  HeartPulse,
  Microscope,
  Pill,
  Rocket,
  Shield,
  Stethoscope,
  Syringe,
  TestTube,
  Users,
  type LucideIcon,
} from 'lucide-react';

export const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  Activity,
  Atom,
  BarChart2,
  Brain,
  Briefcase,
  Building2,
  ClipboardList,
  Database,
  Dna,
  FlaskConical,
  Globe,
  HeartPulse,
  Microscope,
  Pill,
  Rocket,
  Shield,
  Stethoscope,
  Syringe,
  TestTube,
  Users,
};

export const WORKSPACE_ICON_KEYS = Object.keys(WORKSPACE_ICONS);

export function getWorkspaceIcon(iconKey: string | undefined): LucideIcon {
  if (iconKey !== undefined && iconKey !== '' && iconKey in WORKSPACE_ICONS) {
    return WORKSPACE_ICONS[iconKey] as LucideIcon;
  }
  return Building2;
}
