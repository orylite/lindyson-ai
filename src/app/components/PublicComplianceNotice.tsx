import { PUBLIC_COMPLIANCE,getVisiblePublicComplianceRegistrations } from '../data/publicCompliance';

interface PublicComplianceNoticeProps {
  className?: string;
}

export function PublicComplianceNotice({ className }: PublicComplianceNoticeProps) {
  const registrations = getVisiblePublicComplianceRegistrations();

  return (
    <div className={`text-left${className ? ` ${className}` : ''}`}>
      <p data-public-company>{PUBLIC_COMPLIANCE.companyName}</p>
      {registrations.length > 0 && (
        <p data-public-registrations aria-label="网站备案与人工智能服务公示" className="flex flex-wrap items-center justify-start gap-x-2 gap-y-1">
          {registrations.map((registration,index) => (
            <span key={registration.kind} className="inline-flex items-center gap-2">
              {index > 0 && <span aria-hidden="true">·</span>}
              <a
                href={registration.url}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                {registration.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
