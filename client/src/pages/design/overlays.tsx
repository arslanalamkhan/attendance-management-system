import * as React from 'react';
import { toast } from 'sonner';
import { Copy, Download, Eye, MoreHorizontal, Pencil, Share2, Trash2, UserPlus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { Kbd } from '../../components/ui/kbd';
import { Tooltip } from '../../components/ui/tooltip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '../../components/ui/dialog';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '../../components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { Section, Specimen } from './section';

export function OverlaysSection() {
  const [showGrid, setShowGrid] = React.useState(true);
  return (
    <Section id="overlays" title="Overlays" description="Radix primitives: focus is trapped and restored, Escape closes, and everything is labelled.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen label="Dialog · Sheet · Alert dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a colleague</DialogTitle>
                <DialogDescription>Short forms and confirmations live in dialogs. Rich objects get their own page.</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <FormField label="Work email" hint="They will get an invitation link.">
                  <Input type="email" placeholder="name@nacta.gov.pk" />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button onClick={() => toast.success('Invitation sent (demo)')}>Send invite</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Open side sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Quick edit</SheetTitle>
                <SheetDescription>Side sheets are for fast edits that keep the list in view.</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <FormField label="Designation">
                  <Input defaultValue="Deputy Director" />
                </FormField>
                <FormField label="Card number">
                  <Input mono defaultValue="0012345678" />
                </FormField>
              </SheetBody>
              <SheetFooter>
                <SheetClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button onClick={() => toast.success('Saved (demo)')}>Save changes</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive-ghost">Delete employee...</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this employee?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the record and can’t be undone. Attendance history is kept. Spell out the consequence in plain words.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep employee</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => toast.error('Employee deleted (demo)')}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Specimen>

        <Specimen label="Dropdown · Popover · Tooltip · Toast">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                Actions <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start">
              <DropdownMenuLabel>Employee</DropdownMenuLabel>
              <DropdownMenuItem>
                <Eye /> View profile <DropdownMenuShortcut>↵</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Pencil /> Edit <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Share2 /> Push to device
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>All devices</DropdownMenuItem>
                  <DropdownMenuItem>Main entrance</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
                Show templates
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">Popover</Button>
            </PopoverTrigger>
            <PopoverContent className="space-y-3">
              <p className="text-sm font-medium">Quick filter</p>
              <Input placeholder="Wing name" aria-label="Wing name" />
              <Button size="sm" className="w-full">
                Apply
              </Button>
            </PopoverContent>
          </Popover>

          <Tooltip content="Copy employee code" shortcut="C">
            <IconButton label="Copy employee code" icon={<Copy />} variant="secondary" tooltip={false} />
          </Tooltip>
          <IconButton label="Export" icon={<Download />} variant="secondary" shortcut="X" />
          <IconButton label="Add" icon={<UserPlus />} variant="secondary" />

          <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
          <Button variant="subtle" size="sm" onClick={() => toast.success('Changes saved', { description: 'Employee 000817 was updated.' })}>
            Success
          </Button>
          <Button variant="subtle" size="sm" onClick={() => toast.error('Could not reach device', { description: 'Main entrance is offline.' })}>
            Error
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() =>
              toast.promise(new Promise((r) => window.setTimeout(r, 1500)), {
                loading: 'Pushing 24 employees...',
                success: 'Queued 24 commands',
                error: 'Push failed',
              })
            }
          >
            Promise
          </Button>
        </Specimen>
      </div>
    </Section>
  );
}

export function NavigationSection() {
  return (
    <Section id="navigation" title="Navigation" description="Tabs for sibling views, breadcrumbs for depth, ⌘K for everything else.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen label="Tabs" className="block">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="biometrics">Biometrics</TabsTrigger>
              <TabsTrigger value="activity" disabled>
                Activity
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-sm text-muted-foreground">
              Employee profile summary goes here.
            </TabsContent>
            <TabsContent value="attendance" className="text-sm text-muted-foreground">
              Calendar heat-map and timeline.
            </TabsContent>
            <TabsContent value="biometrics" className="text-sm text-muted-foreground">
              Photo, faces and fingerprints.
            </TabsContent>
          </Tabs>
        </Specimen>
        <Specimen label="Breadcrumbs · Keyboard hints" className="block space-y-4">
          <Breadcrumbs items={[{ label: 'People', to: '/' }, { label: 'Employees', to: '/employees' }, { label: 'Ayesha Khan' }]} />
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            Press <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd> to search · <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move through table rows · <Kbd>Esc</Kbd> to close
          </p>
        </Specimen>
      </div>
    </Section>
  );
}
