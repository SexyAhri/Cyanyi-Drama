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
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="pt-6">{children}</div>
    </div>
  );
}
