import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { FoundationsSection } from './design/foundations';
import { FormsSection } from './design/forms';
import { OverlaysSection, NavigationSection } from './design/overlays';
import { FeedbackSection } from './design/feedback';
import { DataSection } from './design/data';
import { usePageMeta } from '../hooks/use-page-meta';

const TOC = [
  ['foundations', 'Foundations'],
  ['buttons', 'Buttons'],
  ['controls', 'Form controls'],
  ['forms', 'Forms'],
  ['overlays', 'Overlays'],
  ['navigation', 'Navigation'],
  ['feedback', 'Feedback'],
  ['stats', 'Stats and charts'],
  ['datatable', 'Data table'],
] as const;

export default function DesignPage() {
  usePageMeta({ title: 'Design system' });
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <>
      <PageHeader
        title="Design system"
        description="The reference for every screen. Components live in src/components/ui; use these, do not restyle."
        actions={
          <Button variant="secondary" size="sm" onClick={toggleTheme}>
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {resolvedTheme === 'dark' ? 'Light' : 'Dark'} theme
          </Button>
        }
      />
      <nav aria-label="On this page" className="mb-8 flex flex-wrap gap-1.5">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md border bg-card px-2.5 py-1 text-[13px] text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {label}
          </a>
        ))}
      </nav>
      <div className="space-y-12 pb-16">
        <FoundationsSection />
        <FormsSection />
        <OverlaysSection />
        <NavigationSection />
        <FeedbackSection />
        <DataSection />
      </div>
    </>
  );
}
