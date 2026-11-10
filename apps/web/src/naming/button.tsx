import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 font-display text-base font-extrabold uppercase tracking-wide transition-[color,transform,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        cta: "bg-cta text-cta-foreground shadow-[4px_4px_0_var(--headline)] hover:-translate-y-0.5 hover:text-secondary-accent hover:shadow-[6px_6px_0_var(--headline)]",
        outline:
          "border-2 border-headline bg-background text-headline shadow-[3px_3px_0_var(--headline)] hover:bg-secondary-accent",
      },
      size: {
        default: "min-h-12 px-6",
        large: "min-h-14 px-8 text-lg",
      },
    },
    defaultVariants: { variant: "cta", size: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
