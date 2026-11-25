import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';

export default function ComingSoonPage({ title, phase }: { title: string; phase?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={<Hourglass />}
        title="Coming soon"
        description={`${title} is on the roadmap${phase ? ` for ${phase}` : ''}. Nothing to configure here yet.`}
        action={
          <Button asChild variant="secondary">
            <Link to="/">Back to dashboard</Link>
          </Button>
        }
      />
    </>
  );
}
