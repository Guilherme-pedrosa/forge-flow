import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}

export function PageHeader({ title, description, breadcrumbs = [], actions }: PageHeaderProps) {
  return (
    <div className="mb-5 min-w-0 md:mb-7">
      {breadcrumbs.length > 0 && (
        <nav aria-label="Localização" className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3 overflow-x-auto">
          <Link to="/" className="hover:text-foreground transition-colors shrink-0">Início</Link>
          {breadcrumbs.map((item, index) => (
            <div key={index} className="flex items-center gap-1.5 shrink-0">
              <ChevronRight className="h-3 w-3" />
              {item.href ? (
                <Link to={item.href} className="hover:text-foreground transition-colors">{item.label}</Link>
              ) : (
                <span className="text-foreground">{item.label}</span>
              )}
            </div>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
