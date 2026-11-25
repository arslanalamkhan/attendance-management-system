import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { REPORT_TYPES, REPORT_TYPE_KEYS } from '@nacta/shared';
import { usePageMeta } from '../../hooks/use-page-meta';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { paramNames, REPORT_ICON } from './report-meta';

/** /reports: the eight reports as cards. */
export default function ReportsPage() {
  usePageMeta({ title: 'Reports' });
  return (
    <>
      <PageHeader title="Reports" description="Run an attendance report on screen, then download it as a branded Excel workbook or PDF." />
      <ul aria-label="Reports" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {REPORT_TYPE_KEYS.map((key) => {
          const r = REPORT_TYPES[key];
          const Icon = REPORT_ICON[key];
          return (
            <li key={key}>
              <Card className="group relative h-full transition-[box-shadow,border-color] duration-150 focus-within:ring-2 focus-within:ring-ring hover:border-border-strong hover:shadow-md">
                <Link to={`/reports/${key}`} className="flex h-full flex-col gap-4 rounded-lg p-5 focus-visible:outline-none">
                  <span className="flex items-start justify-between">
                    <span className="grid size-10 place-content-center rounded-lg bg-primary-subtle text-primary-text [&_svg]:size-5" aria-hidden="true">
                      <Icon />
                    </span>
                    <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" aria-hidden="true" />
                  </span>
                  <span className="space-y-1.5">
                    <span className="block text-sm font-semibold tracking-tight">{r.label}</span>
                    <span className="block text-[13px] leading-snug text-muted-foreground">{r.description}</span>
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    <span className="sr-only">Needs:</span>
                    {paramNames(r.params).map((p) => (
                      <Badge key={p} tone="outline" className="font-normal">
                        {p}
                      </Badge>
                    ))}
                  </span>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
