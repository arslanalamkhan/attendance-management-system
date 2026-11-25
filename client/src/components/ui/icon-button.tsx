import * as React from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  /** Required accessible name; also used as the tooltip text. */
  label: string;
  icon: React.ReactNode;
  tooltip?: boolean;
  shortcut?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, tooltip = true, shortcut, tooltipSide, variant = 'ghost', size = 'icon', loading, ...props }, ref) => {
    const button = (
      <Button ref={ref} variant={variant} size={size} aria-label={label} loading={loading} {...props}>
        {!loading && icon}
      </Button>
    );
    return tooltip ? (
      <Tooltip content={label} shortcut={shortcut} side={tooltipSide} disabled={props.disabled}>
        {button}
      </Tooltip>
    ) : (
      button
    );
  },
);
IconButton.displayName = 'IconButton';
