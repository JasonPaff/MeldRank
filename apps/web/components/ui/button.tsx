'use client';

import { mergeProps } from '@base-ui-components/react/merge-props';
import { useRender } from '@base-ui-components/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  `
    inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm
    font-medium whitespace-nowrap transition-all outline-none
    focus-visible:border-ring focus-visible:ring-[3px]
    focus-visible:ring-ring/50
    disabled:pointer-events-none disabled:opacity-50
    aria-invalid:border-destructive aria-invalid:ring-destructive/20
    [&_svg]:pointer-events-none [&_svg]:shrink-0
    [&_svg:not([class*='size-'])]:size-4
  `,
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: `
          h-9 px-4 py-2
          has-[>svg]:px-3
        `,
        icon: 'size-9',
        lg: `
          h-10 rounded-md px-6
          has-[>svg]:px-4
        `,
        sm: `
          h-8 gap-1.5 rounded-md px-3
          has-[>svg]:px-2.5
        `,
      },
      variant: {
        default: `
          bg-primary text-primary-foreground shadow-xs
          hover:bg-primary/90
        `,
        destructive: `
          bg-destructive text-white shadow-xs
          hover:bg-destructive/90
          focus-visible:ring-destructive/20
        `,
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: `
          text-primary underline-offset-4
          hover:underline
        `,
        outline: `
          border bg-background shadow-xs
          hover:bg-accent hover:text-accent-foreground
        `,
        secondary: `
          bg-secondary text-secondary-foreground shadow-xs
          hover:bg-secondary/80
        `,
      },
    },
  },
);

type ButtonProps = useRender.ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

/**
 * shadcn/ui Button on the Base UI registry. Renders a native `<button>` by
 * default and composes onto a different element via Base UI's `render` prop
 * (`useRender` + `mergeProps`) instead of a Radix `Slot`.
 */
function Button({ className, render = <button />, size, variant, ...props }: ButtonProps) {
  // Held in a variable (not a fresh literal) so the `data-slot` data attribute is
  // not rejected by Base UI's strict `mergeProps` excess-property check.
  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
  };

  return useRender({
    props: mergeProps<'button'>(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
