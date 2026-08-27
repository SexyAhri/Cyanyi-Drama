"use client";

import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  MILESTONE_STATUSES,
  parseProductionAcceptance,
  parseProductionControl,
  type ProductionControl,
} from "@/lib/production/acceptance-contract";

import {
  approveStudioDeliverablesBatch,
  createStudioDeliverable,
  loadStudioBilling,
  loadStudioDeliverables,
  transitionStudioDeliverable,
} from "../api";
import { VersionHistory } from "../post/post-ui";
import { productionLabel } from "../production/copy";
import type {
  ProductionDeliverableCatalog,
  StudioLocale,
  StudioStageState,
  StudioUsageCost,
  WorkspaceSnapshot,
} from "../types";
import {
  buildDefaultProductionControl,
  buildProductionAcceptance,
  getAcceptanceVersions,
  getBatchApprovalCandidates,
  getProductionControlVersions,
  summarizeDepartments,
  summarizeProjectCost,
} from "./production-control-view-model";

const copy = {
  "zh-CN": {
    title: "制片控制台",
    subtitle: "预算、排期、部门审批与总体验收",
    overview: "部门看板",
    plan: "预算与排期",
    approvals: "批量审批",
    acceptance: "总体验收",
    versions: "版本",
    budget: "预算上限",
    currency: "币种",
    contingency: "预备金 %",
    actual: "实际费用",
    forecast: "完工预测",
    variance: "剩余预算",
    milestones: "制作里程碑",
    addMilestone: "添加里程碑",
    milestone: "里程碑",
    department: "部门",
    dueDate: "截止日期",
    status: "状态",
    note: "备注",
    removeMilestone: "删除里程碑",
    productionNotes: "制片备注",
    savePlan: "保存制片计划",
    planSaved: "制片计划版本已保存",
    current: "当前交付物",
    approved: "已批准",
    locked: "已锁定",
    blocked: "阻塞",
    pendingGates: "待审批门",
    noApprovals: "当前没有可批量批准的交付物",
    selected: "已选择",
    selectAll: "选择全部",
    approveSelected: "批准所选",
    confirmApprove: "确认批量批准所选交付物的全部待审批门？该操作在一个事务中完成。",
    approvedBatch: "已批量批准 {count} 项交付物",
    report: "验收报告",
    reportSaved: "总体验收报告已保存",
    saveReport: "保存验收报告",
    checks: "验收检查",
    blockers: "阻塞项",
    noBlockers: "当前检查没有阻塞项",
    audit: "审计引用",
    auditDeliverables: "交付物",
    auditWorkflows: "工作流",
    auditTasks: "任务",
    restored: "历史版本已恢复为新草稿",
    invalid: "数据不完整，无法保存",
    loadFailed: "制片数据载入失败",
    pass: "通过",
    fail: "失败",
    pending: "待完成",
  },
  en: {
    title: "Production control",
    subtitle: "Budget, schedule, department approvals and final acceptance",
    overview: "Department board",
    plan: "Budget and schedule",
    approvals: "Batch approval",
    acceptance: "Acceptance",
    versions: "Versions",
    budget: "Budget limit",
    currency: "Currency",
    contingency: "Contingency %",
    actual: "Actual cost",
    forecast: "Forecast at completion",
    variance: "Budget remaining",
    milestones: "Production milestones",
    addMilestone: "Add milestone",
    milestone: "Milestone",
    department: "Department",
    dueDate: "Due date",
    status: "Status",
    note: "Note",
    removeMilestone: "Remove milestone",
    productionNotes: "Production notes",
    savePlan: "Save production plan",
    planSaved: "Production plan version saved",
    current: "Current deliverables",
    approved: "Approved",
    locked: "Locked",
    blocked: "Blocked",
    pendingGates: "Pending gates",
    noApprovals: "No deliverables are ready for batch approval",
    selected: "selected",
    selectAll: "Select all",
    approveSelected: "Approve selected",
    confirmApprove: "Approve every pending gate for the selected deliverables? The batch is atomic.",
    approvedBatch: "Approved {count} deliverables",
    report: "Acceptance report",
    reportSaved: "Production acceptance report saved",
    saveReport: "Save acceptance report",
    checks: "Acceptance checks",
    blockers: "Blockers",
    noBlockers: "No blockers in the current checks",
    audit: "Audit references",
    auditDeliverables: "deliverables",
    auditWorkflows: "workflows",
    auditTasks: "tasks",
    restored: "Historical version restored as a new draft",
    invalid: "The data is incomplete and cannot be saved",
    loadFailed: "Unable to load production control data",
    pass: "Pass",
    fail: "Fail",
    pending: "Pending",
  },
} as const;

type ControlData = {
  catalog: ProductionDeliverableCatalog;
  costs: StudioUsageCost[];
};

export function ProductionControlWorkspace({
  episode,
  locale,
  onRefresh,
  snapshot,
  stages,
}: {
  episode?: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
  stages: StudioStageState[];
}) {
  const text = copy[locale];
  const projectId = snapshot.project.id;
  const [data, setData] = useState<ControlData | null>(null);
  const [draft, setDraft] = useState<ProductionControl>(() =>
    buildDefaultProductionControl(projectId),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError("");
      try {
        const [catalog, billing] = await Promise.all([
          loadStudioDeliverables(projectId, signal),
          loadStudioBilling(projectId, signal),
        ]);
        if (!signal?.aborted) setData({ catalog, costs: billing.costs });
      } catch (requestError) {
        if (!signal?.aborted)
          setError(
            requestError instanceof Error ? requestError.message : text.loadFailed,
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId, text.loadFailed],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const controlVersions = useMemo(
    () =>
      data ? getProductionControlVersions(data.catalog.deliverables, projectId) : [],
    [data, projectId],
  );
  const currentControl = controlVersions.find(
    (item) => !["stale", "superseded"].includes(item.deliverable.status),
  );
  useEffect(() => {
    setDraft(currentControl?.package ?? buildDefaultProductionControl(projectId));
  }, [currentControl?.deliverable.id, currentControl?.package, projectId]);

  const departmentRows = useMemo(
    () => (data ? summarizeDepartments(data.catalog) : []),
    [data],
  );
  const approvalCandidates = useMemo(
    () => (data ? getBatchApprovalCandidates(data.catalog.deliverables) : []),
    [data],
  );
  const acceptance = useMemo(
    () =>
      data
        ? buildProductionAcceptance({
            catalog: data.catalog,
            control: draft,
            costs: data.costs,
            episodeId: episode?.id,
            generatedAt: new Date().toISOString(),
            stages,
            snapshot,
          })
        : null,
    [data, draft, episode?.id, snapshot, stages],
  );
  const acceptanceVersions = useMemo(
    () =>
      data ? getAcceptanceVersions(data.catalog.deliverables, projectId) : [],
    [data, projectId],
  );
  const actual = data ? summarizeProjectCost(data.costs) : 0;
  const contingency = draft.budget.limit * (draft.budget.contingencyPercent / 100);
  const variance = draft.budget.limit + contingency - actual;

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function savePlan() {
    const parsed = parseProductionControl(draft);
    if (!parsed.success) return toast.error(text.invalid);
    await run(async () => {
      await createStudioDeliverable(projectId, {
        department: "development",
        deliverableType: "production_control",
        title: locale === "en" ? "Production control" : "制片计划",
        scopeType: "project",
        scopeId: projectId,
        payload: parsed.data,
      });
    }, text.planSaved);
  }

  async function approveBatch() {
    if (!selectedIds.length) return false;
    return run(async () => {
      await approveStudioDeliverablesBatch(projectId, selectedIds);
      toast.success(
        text.approvedBatch.replace("{count}", String(selectedIds.length)),
      );
      setSelectedIds([]);
    });
  }

  async function saveAcceptance() {
    if (!acceptance) return;
    const parsed = parseProductionAcceptance(acceptance);
    if (!parsed.success) return toast.error(text.invalid);
    await run(async () => {
      await createStudioDeliverable(projectId, {
        department: "delivery",
        deliverableType: "production_acceptance",
        title: locale === "en" ? "Production acceptance" : "总体验收报告",
        scopeType: "project",
        scopeId: projectId,
        episodeId: episode?.id,
        payload: parsed.data,
        dependencyIds: parsed.data.audit.deliverableIds,
      });
    }, text.reportSaved);
  }

  async function restore(id: string) {
    await run(async () => {
      await transitionStudioDeliverable(projectId, id, { action: "restore" });
    }, text.restored);
  }

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await refreshAll();
      return true;
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : text.invalid);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data)
    return (
      <div className="flex min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );

  if (!data || error)
    return (
      <div className="flex min-h-96 items-center justify-center px-6 text-sm text-destructive">
        {error || text.loadFailed}
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{snapshot.project.name}</p>
          <h1 className="mt-1 text-xl font-semibold">{text.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{text.subtitle}</p>
        </div>
        {currentControl ? <Badge variant="outline">v{currentControl.deliverable.version}</Badge> : null}
      </header>

      <Tabs className="pt-4" defaultValue="overview">
        <TabsList className="max-w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">{text.overview}</TabsTrigger>
          <TabsTrigger value="plan">{text.plan}</TabsTrigger>
          <TabsTrigger value="approvals">{text.approvals}</TabsTrigger>
          <TabsTrigger value="acceptance">{text.acceptance}</TabsTrigger>
          <TabsTrigger value="versions">{text.versions}</TabsTrigger>
        </TabsList>

        <TabsContent className="pt-5" value="overview">
          <div className="grid border-y sm:grid-cols-3">
            <Metric label={text.actual} value={money(draft.budget.currency, actual)} />
            <Metric label={text.forecast} value={money(draft.budget.currency, actual)} />
            <Metric label={text.variance} value={money(draft.budget.currency, variance)} warning={variance < 0} />
          </div>
          <DepartmentBoard locale={locale} rows={departmentRows} text={text} />
        </TabsContent>

        <TabsContent className="space-y-6 pt-5" value="plan">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField label={text.budget} value={draft.budget.limit} onChange={(limit) => setDraft({ ...draft, budget: { ...draft.budget, limit } })} />
            <Field label={text.currency} value={draft.budget.currency} onChange={(currency) => setDraft({ ...draft, budget: { ...draft.budget, currency: currency.toUpperCase() } })} />
            <NumberField label={text.contingency} value={draft.budget.contingencyPercent} onChange={(contingencyPercent) => setDraft({ ...draft, budget: { ...draft.budget, contingencyPercent } })} />
          </div>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{text.milestones}</h2>
              <Button onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, newMilestone(data.catalog, locale)] })} size="sm" variant="outline"><Plus className="size-4" />{text.addMilestone}</Button>
            </div>
            <div className="divide-y border-y">
              {draft.milestones.map((milestone, index) => (
                <div className="grid gap-2 py-3" key={milestone.id}>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.65fr)_2rem]">
                    <Input aria-label={text.milestone} className="h-8 min-w-0" onChange={(event) => updateMilestone(draft, setDraft, index, { name: event.target.value })} value={milestone.name} />
                    <NativeSelect aria-label={text.department} className="h-8 min-w-0" onChange={(event) => updateMilestone(draft, setDraft, index, { department: event.target.value })} value={milestone.department}>{data.catalog.departments.map((department) => <NativeSelectOption key={department.id} value={department.id}>{productionLabel(locale, "departments", department.id)}</NativeSelectOption>)}</NativeSelect>
                    <Button aria-label={text.removeMilestone} className="justify-self-end" onClick={() => setDraft({ ...draft, milestones: draft.milestones.filter((item) => item.id !== milestone.id) })} size="icon-sm" variant="ghost"><Trash2 className="size-3.5" /></Button>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-[9rem_9rem_minmax(0,1fr)] sm:pr-10">
                    <Input aria-label={text.dueDate} className="h-8 min-w-0" onChange={(event) => updateMilestone(draft, setDraft, index, { dueDate: event.target.value })} type="date" value={milestone.dueDate} />
                    <NativeSelect aria-label={text.status} className="h-8 min-w-0" onChange={(event) => updateMilestone(draft, setDraft, index, { status: event.target.value as ProductionControl["milestones"][number]["status"] })} value={milestone.status}>{MILESTONE_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{milestoneStatus(locale, status)}</NativeSelectOption>)}</NativeSelect>
                    <Input aria-label={text.note} className="h-8 min-w-0" onChange={(event) => updateMilestone(draft, setDraft, index, { note: event.target.value })} value={milestone.note} />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <label className="grid gap-1.5 text-sm font-medium">{text.productionNotes}<Textarea className="min-h-24" onChange={(event) => setDraft({ ...draft, notes: event.target.value })} value={draft.notes} /></label>
          <div className="flex justify-end"><Button disabled={busy} onClick={() => void savePlan()} size="sm">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{text.savePlan}</Button></div>
        </TabsContent>

        <TabsContent className="pt-5" value="approvals">
          {approvalCandidates.length ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button onClick={() => setSelectedIds(selectedIds.length === approvalCandidates.length ? [] : approvalCandidates.map((item) => item.id))} size="sm" variant="outline">{text.selectAll}</Button>
                <span className="text-xs text-muted-foreground">{selectedIds.length} {text.selected}</span>
                <BatchApprovalDialog busy={busy} count={selectedIds.length} locale={locale} onConfirm={approveBatch} text={text} />
              </div>
              <div className="divide-y border-y">
                {approvalCandidates.map((item) => <label className="flex items-center gap-3 py-3" key={item.id}><Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={(checked) => setSelectedIds((current) => checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span><Badge variant="outline">{productionLabel(locale, "departments", item.department)}</Badge><span className="text-xs text-muted-foreground">{item.approvalGates.filter((gate) => gate.status === "pending").length} {text.pendingGates}</span></label>)}
              </div>
            </>
          ) : <p className="border-y py-5 text-sm text-muted-foreground">{text.noApprovals}</p>}
        </TabsContent>

        <TabsContent className="space-y-5 pt-5" value="acceptance">
          {acceptance ? (
            <>
              <div className="flex items-center justify-between gap-3 border-y py-3"><div className="flex items-center gap-2"><AcceptanceIcon status={acceptance.overallStatus} /><h2 className="text-sm font-semibold">{text.report}</h2><StatusBadge locale={locale} status={acceptance.overallStatus} /></div><Button disabled={busy} onClick={() => void saveAcceptance()} size="sm"><ClipboardCheck className="size-4" />{text.saveReport}</Button></div>
              <section><h3 className="mb-2 text-sm font-semibold">{text.checks}</h3><div className="divide-y border-y">{acceptance.checks.map((check) => <div className="grid min-w-0 gap-1 py-2.5 sm:grid-cols-[auto_minmax(9rem,1fr)_minmax(12rem,1.5fr)] sm:items-center sm:gap-3" key={check.id}><StatusBadge locale={locale} status={check.status} /><span className="min-w-0 text-sm">{acceptanceCheckLabel(locale, check.id)}</span><span className="min-w-0 text-xs text-muted-foreground">{acceptanceEvidence(locale, check.evidence)}</span></div>)}</div></section>
              <section><h3 className="mb-2 text-sm font-semibold">{text.blockers}</h3>{acceptance.blockers.length ? <ul className="space-y-2 border-l-2 border-destructive pl-3 text-sm text-muted-foreground">{acceptance.blockers.map((blocker) => <li key={blocker}>{acceptanceBlocker(locale, blocker)}</li>)}</ul> : <p className="border-y py-4 text-sm text-muted-foreground">{text.noBlockers}</p>}</section>
              <p className="text-xs text-muted-foreground">{text.audit} · {acceptance.audit.deliverableIds.length} {text.auditDeliverables} · {acceptance.audit.workflowIds.length} {text.auditWorkflows} · {acceptance.audit.taskIds.length} {text.auditTasks}</p>
            </>
          ) : null}
        </TabsContent>

        <TabsContent className="space-y-5 pt-5" value="versions">
          <section><h2 className="mb-2 text-sm font-semibold">{text.plan}</h2><VersionHistory busy={busy} locale={locale} onRestore={(id) => void restore(id)} versions={controlVersions.map((item) => ({ deliverable: item.deliverable, summary: item.package ? `${item.package.budget.currency} ${item.package.budget.limit} · ${item.package.milestones.length} ${text.milestones}` : item.deliverable.title }))} /></section>
          <section><h2 className="mb-2 text-sm font-semibold">{text.acceptance}</h2><VersionHistory busy={busy} locale={locale} onRestore={(id) => void restore(id)} versions={acceptanceVersions.map((item) => ({ deliverable: item.deliverable, summary: item.report ? `${statusLabel(locale, item.report.overallStatus)} · ${item.report.checks.length} ${text.checks}` : item.deliverable.title }))} /></section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DepartmentBoard({ locale, rows, text }: { locale: StudioLocale; rows: ReturnType<typeof summarizeDepartments>; text: (typeof copy)[StudioLocale] }) {
  return <div className="mt-5 divide-y border-y">{rows.map((row) => <div className="grid gap-2 py-3 sm:grid-cols-[minmax(10rem,1fr)_repeat(5,5rem)]" key={row.id}><div className="flex min-w-0 items-center gap-2"><UsersRound className="size-4 text-muted-foreground" /><span className="truncate text-sm font-medium">{productionLabel(locale, "departments", row.id)}</span></div><SmallMetric label={text.current} value={row.current} /><SmallMetric label={text.approved} value={row.approved} /><SmallMetric label={text.locked} value={row.locked} /><SmallMetric label={text.blocked} value={row.blocked} warning={row.blocked > 0} /><SmallMetric label={text.pendingGates} value={row.pendingGates} /></div>)}</div>;
}
function Metric({ label, value, warning }: { label: string; value: string; warning?: boolean }) { return <div className="border-b px-3 py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"><p className="text-xs text-muted-foreground">{label}</p><p className={warning ? "mt-1 font-mono text-lg font-semibold text-destructive" : "mt-1 font-mono text-lg font-semibold"}>{value}</p></div>; }
function SmallMetric({ label, value, warning }: { label: string; value: number; warning?: boolean }) { return <div className="flex items-center justify-between gap-2 sm:block sm:text-right"><span className="block text-[10px] text-muted-foreground">{label}</span><span className={warning ? "block font-mono text-xs font-semibold text-destructive sm:mt-1" : "block font-mono text-xs font-semibold sm:mt-1"}>{value}</span></div>; }
function Field({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="grid gap-1.5 text-sm font-medium">{label}<Input onChange={(event) => onChange(event.target.value)} value={value} /></label>; }
function NumberField({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) { return <label className="grid gap-1.5 text-sm font-medium">{label}<Input min={0} onChange={(event) => onChange(Number(event.target.value) || 0)} type="number" value={value} /></label>; }
function BatchApprovalDialog({ busy, count, locale, onConfirm, text }: { busy: boolean; count: number; locale: StudioLocale; onConfirm: () => Promise<boolean>; text: (typeof copy)[StudioLocale] }) { const [open, setOpen] = useState(false); return <AlertDialog onOpenChange={setOpen} open={open}><AlertDialogTrigger render={<Button className="ml-auto" disabled={busy || !count} size="sm" />}><Check className="size-4" />{text.approveSelected}</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{text.approveSelected}</AlertDialogTitle><AlertDialogDescription>{text.confirmApprove}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{locale === "en" ? "Cancel" : "取消"}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={async (event) => { event.preventDefault(); if (await onConfirm()) setOpen(false); }}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{locale === "en" ? "Approve" : "批准"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>; }
function AcceptanceIcon({ status }: { status: "pending" | "pass" | "fail" }) { return status === "pass" ? <Check className="size-4 text-emerald-600" /> : status === "fail" ? <AlertTriangle className="size-4 text-destructive" /> : <span className="size-2 rounded-full bg-muted-foreground/50" />; }
function StatusBadge({ locale, status }: { locale: StudioLocale; status: "pending" | "pass" | "fail" }) { return <Badge variant={status === "fail" ? "destructive" : "outline"}>{statusLabel(locale, status)}</Badge>; }
function statusLabel(locale: StudioLocale, status: "pending" | "pass" | "fail") { const values = { pending: ["待完成", "Pending"], pass: ["通过", "Pass"], fail: ["失败", "Fail"] } as const; return values[status][locale === "en" ? 1 : 0]; }
function milestoneStatus(locale: StudioLocale, status: ProductionControl["milestones"][number]["status"]) { const values = { not_started: ["未开始", "Not started"], in_progress: ["进行中", "In progress"], completed: ["已完成", "Completed"], blocked: ["阻塞", "Blocked"] } as const; return values[status][locale === "en" ? 1 : 0]; }
function acceptanceCheckLabel(locale: StudioLocale, id: string) {
  const labels: Record<string, readonly [string, string]> = {
    runtime: ["任务与工作流", "Tasks and workflows"],
    "stage-readiness": ["制作阶段就绪度", "Production stage readiness"],
    "approval-chain": ["交付物批准链", "Deliverable approval chain"],
    budget: ["制作预算", "Production budget"],
    schedule: ["制作排期", "Production schedule"],
    "sound-loudness": ["节目响度", "Program loudness"],
    "sound-true_peak": ["真峰值", "True peak"],
    "sound-dialogue_sync": ["对白同步", "Dialogue sync"],
    "sound-intelligibility": ["对白可懂度", "Dialogue intelligibility"],
    "master-frame_rate": ["帧率一致性", "Frame rate"],
    "master-resolution": ["分辨率", "Resolution"],
    "master-color_space": ["色彩空间", "Color space"],
    "master-black_frames": ["黑帧 / 坏帧", "Black / bad frames"],
    "master-subtitle_coverage": ["字幕覆盖", "Subtitle coverage"],
    "master-subtitle_safe_area": ["字幕安全区", "Subtitle safe area"],
  };
  const label = labels[id];
  return label ? label[locale === "en" ? 1 : 0] : id;
}
function acceptanceEvidence(locale: StudioLocale, evidence: string) {
  let match = evidence.match(/^(\d+) failed, (\d+) active$/);
  if (match) return locale === "en" ? evidence : `${match[1]} 个失败，${match[2]} 个运行中`;
  match = evidence.match(/^(\d+) stages, (\d+) incomplete, (\d+) failed or blocked$/);
  if (match) return locale === "en" ? evidence : `${match[1]} 个阶段，${match[2]} 个未完成，${match[3]} 个失败或阻塞`;
  match = evidence.match(/^(\d+) current, (\d+) unlocked, (\d+) stale$/);
  if (match) return locale === "en" ? evidence : `${match[1]} 个当前版本，${match[2]} 个未锁定，${match[3]} 个已失效`;
  match = evidence.match(/^(\d+) milestones, (\d+) overdue, (\d+) blocked$/);
  if (match) return locale === "en" ? `${match[1]} milestone${match[1] === "1" ? "" : "s"}, ${match[2]} overdue, ${match[3]} blocked` : `${match[1]} 个里程碑，${match[2]} 个逾期，${match[3]} 个阻塞`;
  if (evidence === "sound package missing") return locale === "en" ? evidence : "缺少声音后期包";
  if (evidence === "master package missing") return locale === "en" ? evidence : "缺少后期母版包";
  return locale === "en" ? evidence : evidence.replaceAll("n/a", "无数据");
}
function acceptanceBlocker(locale: StudioLocale, blocker: string) {
  const separator = blocker.indexOf(": ");
  if (separator < 0) return acceptanceEvidence(locale, blocker);
  const id = blocker.slice(0, separator);
  const evidence = blocker.slice(separator + 2);
  return `${acceptanceCheckLabel(locale, id)}${locale === "en" ? ": " : "："}${acceptanceEvidence(locale, evidence)}`;
}
function money(currency: string, value: number) { return `${currency} ${value.toFixed(2)}`; }
function updateMilestone(draft: ProductionControl, setDraft: (value: ProductionControl) => void, index: number, value: Partial<ProductionControl["milestones"][number]>) { setDraft({ ...draft, milestones: draft.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }); }
function newMilestone(catalog: ProductionDeliverableCatalog, locale: StudioLocale): ProductionControl["milestones"][number] { const dueDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10); return { id: crypto.randomUUID(), name: locale === "en" ? "New milestone" : "新里程碑", department: catalog.departments[0]?.id ?? "development", dueDate, status: "not_started", note: "" }; }
