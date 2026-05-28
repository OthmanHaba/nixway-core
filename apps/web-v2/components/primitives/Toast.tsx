"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...rest }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed top-4 right-4 z-[100] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] list-none outline-none",
      className,
    )}
    {...rest}
  />
));
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & { tone?: "default" | "error" | "success" }
>(({ className, tone = "default", ...rest }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(
      "grid grid-cols-[auto_max-content] items-start gap-x-3 gap-y-1",
      "rounded-[var(--radius)] border border-line-1 bg-surface-1 px-4 py-3",
      "shadow-[0_8px_24px_-12px_color-mix(in_oklch,black_40%,transparent)]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full",
      "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
      tone === "error" && "border-l-2 border-l-alert",
      tone === "success" && "border-l-2 border-l-online",
      className,
    )}
    {...rest}
  />
));
Toast.displayName = ToastPrimitive.Root.displayName;

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...rest }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-[13px] font-medium text-ink-1", className)}
    {...rest}
  />
));
ToastTitle.displayName = ToastPrimitive.Title.displayName;

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...rest }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-[12px] text-ink-3", className)}
    {...rest}
  />
));
ToastDescription.displayName = ToastPrimitive.Description.displayName;

export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...rest }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "text-ink-3 hover:text-ink-1 transition-colors row-span-2 self-start -mt-0.5",
      className,
    )}
    {...rest}
  >
    <X className="h-3.5 w-3.5" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = ToastPrimitive.Close.displayName;
