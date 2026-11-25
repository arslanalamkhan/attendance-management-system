import { Inbox, SearchX } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { Avatar } from '../../components/ui/avatar';
import { Badge, DeviceStatusPill, StatusPill } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { Kbd } from '../../components/ui/kbd';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Separator } from '../../components/ui/separator';
import { Skeleton } from '../../components/ui/skeleton';
import { Section, Specimen } from './section';

export function FeedbackSection() {
  return (
    <Section id="feedback" title="Status and feedback" description="Colour is never the only signal: every status carries a label. Every empty state offers a next step.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen label="Badges">
          <Badge>Neutral</Badge>
          <Badge tone="primary">Primary</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="outline">Outline</Badge>
        </Specimen>
        <Specimen label="Status pills">
          <DeviceStatusPill status="online" />
          <DeviceStatusPill status="offline" />
          <DeviceStatusPill status="unknown" />
          <StatusPill tone="warning">Late</StatusPill>
          <StatusPill tone="info">On leave</StatusPill>
        </Specimen>
        <Specimen label="Avatars">
          <Avatar name="Ayesha Khan" size="xs" />
          <Avatar name="Bilal Ahmed" size="sm" />
          <Avatar name="Chaudhry Usman" size="md" />
          <Avatar name="Dr Fatima Noor" size="lg" />
          <Avatar name="Super Admin" size="xl" />
        </Specimen>
        <Specimen label="Skeleton · Separator · Scroll area · Kbd" className="block space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Separator />
          <ScrollArea className="h-24 rounded-md border">
            <ul className="space-y-1 p-3 text-[13px]">
              {Array.from({ length: 14 }, (_, i) => (
                <li key={i} className="font-mono text-muted-foreground">
                  punch #{String(1000 + i)} · 08:{String(10 + i).padStart(2, '0')}:00
                </li>
              ))}
            </ul>
          </ScrollArea>
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Shortcut <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </p>
        </Specimen>
        <EmptyState
          icon={<Inbox />}
          title="No employees yet"
          description="Add your first employee or import them from a device."
          action={
            <>
              <Button size="sm">Add employee</Button>
              <Button size="sm" variant="secondary">
                Import from device
              </Button>
            </>
          }
        />
        <EmptyState icon={<SearchX />} title="No matches" description="Nothing fits those filters." action={<Button size="sm" variant="secondary">Clear filters</Button>} />
        <ErrorState
          error={new ApiError({ status: 500, code: 'INTERNAL', message: 'The server hit an unexpected error.', requestId: 'req_8f3a21' })}
          onRetry={() => undefined}
        />
        <ErrorState error={new ApiError({ status: 0, code: 'NETWORK', message: 'Cannot reach the server.' })} onRetry={() => undefined} />
      </div>
    </Section>
  );
}
