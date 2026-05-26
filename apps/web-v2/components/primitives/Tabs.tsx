"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "flex items-center gap-1 border-b border-line-1",
      "-mx-1 px-1",
      className,
    )}
    {...rest}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative px-3 py-2.5 -mb-px",
      "font-mono uppercase tracking-[0.14em] text-[11px]",
      "text-ink-3 hover:text-ink-1 transition-colors",
      "border-b-2 border-transparent",
      "data-[state=active]:text-ink-1 data-[state=active]:border-signal",
      "disabled:opacity-50 disabled:pointer-events-none",
      "outline-none focus-visible:text-ink-1",
      className,
    )}
    {...rest}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("pt-6 outline-none", className)}
    {...rest}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
