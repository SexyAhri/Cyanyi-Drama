"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

// A nested Tabs root starts a new style scope, just like Base UI's behavior scope.
const TabsListVariantContext = createContext<"default" | "line">("default");

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsListVariantContext.Provider value="default">
      <TabsPrimitive.Root
        data-slot="tabs"
        orientation={orientation}
        className={cn(
          "flex gap-2 data-[orientation=horizontal]:flex-col",
          className,
        )}
        {...props}
      />
    </TabsListVariantContext.Provider>
  );
}

const tabsListVariants = cva(
  "inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground data-[orientation=vertical]:h-fit data-[orientation=vertical]:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted data-[orientation=horizontal]:h-8",
        line: "gap-1 bg-transparent data-[orientation=horizontal]:min-h-8 data-[orientation=horizontal]:h-auto overflow-y-hidden",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsListVariantContext.Provider value={variant ?? "default"}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsListVariantContext.Provider>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  const variant = useContext(TabsListVariantContext);
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground data-[variant=default]:data-active:shadow-sm data-[variant=line]:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-[variant=line]:bg-transparent data-[variant=line]:data-active:bg-transparent dark:data-[variant=line]:data-active:border-transparent dark:data-[variant=line]:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity data-[orientation=horizontal]:after:inset-x-0 data-[orientation=horizontal]:after:bottom-[-5px] data-[orientation=horizontal]:after:h-0.5 data-[orientation=vertical]:after:inset-y-0 data-[orientation=vertical]:after:-right-1 data-[orientation=vertical]:after:w-0.5 data-[variant=line]:data-active:after:opacity-100",
        "data-[orientation=horizontal]:data-[variant=line]:after:bottom-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
