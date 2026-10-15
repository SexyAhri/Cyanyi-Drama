import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, tablePageRange } from "./data-table";
import { TableRow, TableCell } from "./table";

describe("bounded data table pagination", () => {
  it("keeps every record reachable, including the partial last page", () => {
    const records = Array.from({ length: 23 }, (_, i) => i);
    const seen = [1, 2, 3, 4].flatMap(page => {
      const { start, end } = tablePageRange(records.length, 6, page);
      return records.slice(start, end);
    });
    expect(seen).toEqual(records);
    expect(tablePageRange(23, 6, 4)).toEqual({ page: 4, pages: 4, start: 18, end: 23 });
  });
  it("clamps a removed last page and handles an empty filtered result", () => {
    expect(tablePageRange(3, 6, 4)).toEqual({ page: 1, pages: 1, start: 0, end: 3 });
    expect(tablePageRange(0, 0, 0)).toEqual({ page: 1, pages: 1, start: 0, end: 0 });
  });
  it("renders semantic table components and bounded controls with a truthful loaded count", () => {
    const html = renderToStaticMarkup(<DataTable label="Records" headers={["Record"]} empty="Empty" totalCount={100}>
      {Array.from({ length: 12 }, (_, i) => <TableRow key={i}><TableCell>{`Record #${i}`}</TableCell></TableRow>)}
    </DataTable>);
    expect(html).toContain('data-slot="table"');
    expect(html).toContain('aria-label="Records分页"');
    expect(html).toContain("最近 12 条，共 100 条匹配");
    expect(html).toContain("Record #9");
    expect(html).not.toContain("Record #10");
    expect(html).toContain("overscroll-contain");
  });
  it("exposes loading and empty states without pretending there are records", () => {
    const html = renderToStaticMarkup(<DataTable label="Records" loading headers={["Record"]} empty="Empty">{[]}</DataTable>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在加载…");
    expect(html).toContain("正在加载…");
    expect(renderToStaticMarkup(<DataTable label="Records" headers={["Record"]} empty="No matches">{[]}</DataTable>)).toContain("No matches");
  });
  it("renders the supplied remote page without slicing it again", () => {
    const html = renderToStaticMarkup(<DataTable label="Remote" headers={["Record"]} empty="Empty" pagination={{ page: 61, pageSize: 20, total: 1205, onPageChange: () => {}, onPageSizeChange: () => {} }}>
      <TableRow key="last"><TableCell>Final record</TableCell></TableRow>
    </DataTable>);
    expect(html).toContain("Final record");
    expect(html).toContain("1201–1205 / 1205 条");
    expect(html).toContain("61 / 61");
  });
});
