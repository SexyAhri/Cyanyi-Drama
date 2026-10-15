"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function tablePageRange(
  count: number,
  pageSize: number,
  requestedPage: number,
) {
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.min(pages, Math.max(1, requestedPage));
  return {
    page,
    pages,
    start: (page - 1) * size,
    end: Math.min(count, page * size),
  };
}

/** A bounded table with page sizes fitted to its available height. */
export type DataTablePagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function DataTable({
  children,
  headers,
  empty,
  label,
  loading = false,
  className,
  totalCount,
  pagination: remote,
  locale = "zh-CN",
}: {
  children: ReactNode;
  headers: ReactNode[];
  empty: string;
  label: string;
  loading?: boolean;
  className?: string;
  totalCount?: number;
  pagination?: DataTablePagination;
  locale?: "zh-CN" | "en";
}) {
  const rows = Children.toArray(children);
  const dataKey = rows
    .map((row, index) =>
      typeof row === "object" && "key" in row ? row.key : index,
    )
    .join("|");
  const [pagination, setPagination] = useState({ key: dataKey, page: 1 });
  const [pageSize, setPageSize] = useState(10);
  const viewport = useRef<HTMLDivElement>(null);
  const tallestRow = useRef(48);
  const range = remote
    ? tablePageRange(remote.total, remote.pageSize, remote.page)
    : tablePageRange(
        rows.length,
        pageSize,
        pagination.key === dataKey ? pagination.page : 1,
      );
  const onPageSizeChange = remote?.onPageSizeChange;
  const serverPaginated = Boolean(remote);
  useEffect(() => {
    onPageSizeChange?.(pageSize);
  }, [onPageSizeChange, pageSize]);
  const changePage = (page: number) =>
    remote ? remote.onPageChange(page) : setPagination({ key: dataKey, page });
  const previousLabel = locale === "en" ? "Previous page" : "上一页";
  const nextLabel = locale === "en" ? "Next page" : "下一页";

  useEffect(() => {
    const pane = viewport.current;
    if (!pane) return;
    if (!serverPaginated && rows.length) tallestRow.current = 48;
    const measure = () => {
      if (!pane.clientHeight) return;
      const headerHeight =
        pane.querySelector("thead")?.getBoundingClientRect().height ?? 40;
      for (const row of pane.querySelectorAll("tbody tr:not([data-empty])")) {
        tallestRow.current = Math.max(
          tallestRow.current,
          row.getBoundingClientRect().height,
        );
      }
      // Reserve room for a horizontal scrollbar on narrow screens.
      const next = Math.max(
        1,
        Math.min(
          50,
          Math.floor(
            (pane.clientHeight - headerHeight - 18) / tallestRow.current,
          ),
        ),
      );
      setPageSize((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    const table = pane.querySelector("table");
    if (table) observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, [dataKey, serverPaginated, rows.length]);

  return (
    <div
      aria-label={label}
      aria-busy={loading}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-hidden rounded-md border"
      >
        <Table
          className={cn("[&_tbody_tr]:h-12", className)}
          containerClassName="h-full overflow-auto overscroll-contain"
          aria-label={label}
        >
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {headers.map((header, index) => (
                <TableHead key={index} scope="col">
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              remote ? (
                rows
              ) : (
                rows.slice(range.start, range.end)
              )
            ) : (
              <TableRow data-empty>
                <TableCell
                  colSpan={headers.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {loading
                    ? locale === "en"
                      ? "Loading…"
                      : "正在加载…"
                    : empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t-0 py-2 text-xs text-muted-foreground">
        <p aria-live="polite">
          {loading && !rows.length
            ? locale === "en"
              ? "Loading…"
              : "正在加载…"
            : rows.length
              ? `${range.start + 1}–${range.end} / ${remote?.total ?? rows.length} ${locale === "en" ? "records" : "条"}`
              : locale === "en"
                ? "0 records"
                : "0 条"}
          {!remote && totalCount !== undefined && totalCount > rows.length
            ? `（最近 ${rows.length} 条，共 ${totalCount} 条匹配）`
            : ""}
        </p>
        <nav
          aria-label={locale === "en" ? `${label} pagination` : `${label}分页`}
          className="flex items-center gap-2"
        >
          <Button
            aria-label={previousLabel}
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={range.page === 1 || loading}
            onClick={() => changePage(range.page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="tabular-nums">
            {range.page} / {range.pages}
          </span>
          <Button
            aria-label={nextLabel}
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={range.page === range.pages || loading}
            onClick={() => changePage(range.page + 1)}
          >
            <ChevronRight />
          </Button>
        </nav>
      </div>
    </div>
  );
}
