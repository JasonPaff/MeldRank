'use client';

import { mergeProps } from '@base-ui-components/react/merge-props';
import { useRender } from '@base-ui-components/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  `
    inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md
    border px-2 py-0.5 text-xs font-medium whitespace-nowrap
    [&>svg]:pointer-events-none [&>svg]:size-3
  `,
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
      },
    },
  },
);

type BadgeProps = useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

/**
 * shadcn/ui Badge on the Base UI registry (matching {@link Button}). Renders a
 * native `<span>` by default and composes onto a different element via Base UI's
 * `render` prop. The occupancy/status chip primitive for the hall (design D8a); it
 * carries no feature logic.
 */
function Badge({ className, render = <span />, variant, ...props }: BadgeProps) {
  // Held in a variable (not a fresh literal) so the `data-slot` data attribute is
  // not rejected by Base UI's strict `mergeProps` excess-property check.
  const defaultProps = {
    className: cn(badgeVariants({ className, variant })),
    'data-slot': 'badge',
  };

  return useRender({
    props: mergeProps<'span'>(defaultProps, props),
    render,
  });
}

export { Badge, badgeVariants };
