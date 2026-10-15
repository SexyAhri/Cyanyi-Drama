export function AdminPage({
  actions,
  children,
  description,
  title,
}: React.PropsWithChildren<{
  actions?: React.ReactNode;
  description: string;
  title: string;
}>) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">{children}</div>
    </div>
  );
}
