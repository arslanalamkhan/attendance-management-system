import { Toaster as Sonner } from 'sonner';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTheme } from '../../lib/theme';

/** Mount once at the root. Fire toasts with `import { toast } from 'sonner'`. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      closeButton
      gap={8}
      icons={{
        success: <CircleCheck className="size-4 text-success" aria-hidden="true" />,
        error: <CircleAlert className="size-4 text-danger" aria-hidden="true" />,
        warning: <TriangleAlert className="size-4 text-warning" aria-hidden="true" />,
        info: <Info className="size-4 text-info" aria-hidden="true" />,
        loading: <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-lg !border !border-border !bg-popover !p-3.5 !text-sm !text-popover-foreground !shadow-pop !font-sans',
          title: '!font-medium',
          description: '!text-[13px] !text-muted-foreground',
          actionButton: '!rounded-md !bg-primary !text-primary-foreground !font-medium',
          cancelButton: '!rounded-md !bg-muted !text-foreground',
          closeButton: '!border-border !bg-popover !text-muted-foreground hover:!bg-muted',
        },
      }}
    />
  );
}
