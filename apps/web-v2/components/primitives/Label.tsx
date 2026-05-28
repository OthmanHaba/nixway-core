"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...rest }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("label-mono select-none cursor-default", className)}
    {...rest}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
