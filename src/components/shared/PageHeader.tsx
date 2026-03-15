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
    <div className="mb-6">
      {breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <Link to="/" className="hover:text-foreground transition-colors">Início</Link>
          {breadcrumbs.map((item, index) => (
            <div key={index} className="flex items-center gap-1.5">
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
