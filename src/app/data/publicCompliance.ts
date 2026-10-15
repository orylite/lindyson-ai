// 仓库内的 publicCompliance.json 只是占位模板。正式站点把真实的运营主体、备案与法律联系信息
// 写到同目录的 publicCompliance.local.json（已被 git 忽略）；vite.config.ts 在存在该文件时用它替换模板。
import publicComplianceJson from './publicCompliance.json';

export type PublicComplianceRegistrationKind = 'icp' | 'publicSecurity' | 'aiApplication' | 'aiModel';

export interface PublicComplianceRegistration {
  label: string;
  url: string;
}

export interface PublicComplianceLegal {
  privacyContactEmail: string;
  effectiveDate: string;
}

export interface PublicComplianceConfig {
  companyName: string;
  legal: PublicComplianceLegal;
  registrations: Record<PublicComplianceRegistrationKind,PublicComplianceRegistration | null>;
}

export interface VisiblePublicComplianceRegistration extends PublicComplianceRegistration {
  kind: PublicComplianceRegistrationKind;
}

export const PUBLIC_COMPLIANCE: PublicComplianceConfig = publicComplianceJson;

export const PUBLIC_COMPLIANCE_REGISTRATION_ORDER = [
  'icp',
  'publicSecurity',
  'aiApplication',
  'aiModel',
] as const satisfies readonly PublicComplianceRegistrationKind[];

function isDisplayableRegistration(
  registration: PublicComplianceRegistration | null,
): registration is PublicComplianceRegistration {
  if (!registration?.label.trim() || !registration.url.trim()) return false;

  try {
    const url = new URL(registration.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getVisiblePublicComplianceRegistrations(
  config: PublicComplianceConfig = PUBLIC_COMPLIANCE,
): VisiblePublicComplianceRegistration[] {
  return PUBLIC_COMPLIANCE_REGISTRATION_ORDER.flatMap(kind => {
    const registration = config.registrations[kind];
    return isDisplayableRegistration(registration)
      ? [{ kind,label: registration.label.trim(),url: registration.url.trim() }]
      : [];
  });
}
