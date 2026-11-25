import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';

export default function NotFoundPage() {
  return (
    <EmptyState
      className="mt-10"
      icon={<Compass />}
      title="Page not found"
      description="The page you are looking for does not exist or has moved."
      action={
        <Button asChild>
          <Link to="/">Go to dashboard</Link>
        </Button>
      }
    />
  );
}
