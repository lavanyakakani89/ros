"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CalendarDays, Check, CreditCard, Plus, RefreshCw, Send, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { createAuthenticatedApiClient, type PaginatedResponse } from "@/lib/api-client";

type SalaryType = "MONTHLY" | "DAILY" | "HOURLY";
type EmployeeStatus = "ACTIVE" | "INACTIVE" | "TERMINATED";
type AttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE" | "ON_DUTY";
type PayrollStatus = "DRAFT" | "APPROVED" | "PAID";
type AdvanceStatus = "PENDING" | "APPROVED" | "REJECTED" | "RECOVERED";

interface Employee {
  id: string;
  name: string;
  phone: string;
  role: string;
  department: string;
  baseSalary: number;
  paidLeavesPerMonth: number;
  salaryType: SalaryType;
  status: EmployeeStatus;
  joinedAt: string;
}

interface AttendanceRow {
  id: string;
  employeeId: string;
  employee?: Pick<Employee, "id" | "name" | "department">;
  date: string;
  status: AttendanceStatus;
  overtimeMinutes: number;
  note?: string | null;
}

interface PayAdvance {
  id: string;
  employeeId: string;
  employee?: Pick<Employee, "id" | "name" | "department">;
  amount: number;
  reason?: string | null;
  status: AdvanceStatus;
  requestedAt: string;
}

interface PayrollRun {
  id: string;
  period: string;
  runAt: string;
  status: PayrollStatus;
  notes?: string | null;
  counts?: { payslipLines: number; recoveredAdvances: number };
}

interface PayslipLine {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employee?: Pick<Employee, "id" | "name" | "department" | "role">;
  payrollRun?: Pick<PayrollRun, "id" | "period" | "status">;
  daysWorked: number;
  overtimeHours: number;
  grossPay: number;
  overtimePay: number;
  advancesDeducted: number;
  otherDeductions: number;
  netPay: number;
}

interface PayrollDisbursement {
  id: string;
  employee?: Pick<Employee, "id" | "name" | "department">;
  payrollRun?: Pick<PayrollRun, "id" | "period" | "status">;
  paymentMethod?: { id: string; name: string; short_code: string; color: string };
  amount: number;
  referenceNumber?: string | null;
  paidAt: string;
  paidBy?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

interface PaymentMethod {
  id: string;
  name: string;
  short_code: string;
  color: string;
  type: string;
}

interface PayrollRunDetail extends PayrollRun {
  payslips: PayslipLine[];
  recoveredAdvances: PayAdvance[];
  disbursements: PayrollDisbursement[];
}

const tabs = [
  { id: "employees", label: "Employees", icon: Users },
  { id: "attendance", label: "Attendance", icon: CalendarDays },
  { id: "advances", label: "Advances", icon: Banknote },
  { id: "runs", label: "Run payroll", icon: RefreshCw },
  { id: "disbursements", label: "Disbursement", icon: CreditCard },
] as const;

type TabId = (typeof tabs)[number]["id"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export function PayrollClient() {
  const api = createAuthenticatedApiClient();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("employees");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState({
    name: "",
    phone: "",
    role: "Cashier",
    department: "Store",
    baseSalary: "",
    paidLeavesPerMonth: "0",
    salaryType: "MONTHLY" as SalaryType,
    joinedAt: today(),
  });
  const [attendanceForm, setAttendanceForm] = useState({
    employeeId: "",
    date: today(),
    status: "PRESENT" as AttendanceStatus,
    overtimeMinutes: "0",
    note: "",
  });
  const [advanceForm, setAdvanceForm] = useState({ employeeId: "", amount: "", reason: "" });
  const [runForm, setRunForm] = useState({ period: currentPeriod(), notes: "" });
  const [deductionForm, setDeductionForm] = useState<Record<string, string>>({});
  const [disburseForm, setDisburseForm] = useState({ paymentMethodId: "", referencePrefix: "SALARY", paidAt: today() });

  const employeesQuery = useQuery({
    queryKey: ["payroll", "employees"],
    queryFn: () => api.get<PaginatedResponse<Employee>>("/payroll/employees?limit=100"),
  });
  const attendanceQuery = useQuery({
    queryKey: ["payroll", "attendance"],
    queryFn: () => api.get<PaginatedResponse<AttendanceRow>>(`/payroll/attendance?dateFrom=${currentPeriod()}-01&dateTo=${today()}&limit=100`),
  });
  const advancesQuery = useQuery({
    queryKey: ["payroll", "advances"],
    queryFn: () => api.get<PaginatedResponse<PayAdvance>>("/payroll/advances?limit=100"),
  });
  const runsQuery = useQuery({
    queryKey: ["payroll", "runs"],
    queryFn: () => api.get<PaginatedResponse<PayrollRun>>("/payroll/runs?limit=50"),
  });
  const paymentMethodsQuery = useQuery({
    queryKey: ["payment-methods", "payroll-disbursement"],
    queryFn: () => api.get<PaymentMethod[]>("/payment-methods"),
  });
  const disbursementsQuery = useQuery({
    queryKey: ["payroll", "disbursements"],
    queryFn: () => api.get<PaginatedResponse<PayrollDisbursement>>("/payroll/disbursements?limit=100"),
  });

  const runs = runsQuery.data?.data ?? [];
  const runId = selectedRunId ?? runs[0]?.id ?? null;
  const currentRunId = runId ?? "";
  const runDetailQuery = useQuery({
    queryKey: ["payroll", "runs", runId],
    enabled: Boolean(runId),
    queryFn: () => api.get<PayrollRunDetail>(`/payroll/runs/${currentRunId}`),
  });

  const employees = employeesQuery.data?.data ?? [];
  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE");
  const runDetail = runDetailQuery.data ?? null;
  const payslips = runDetail?.payslips ?? [];
  const paymentMethods = paymentMethodsQuery.data ?? [];

  const payrollTotals = useMemo(() => {
    return payslips.reduce(
      (sum, line) => ({
        gross: sum.gross + line.grossPay + line.overtimePay,
        deductions: sum.deductions + line.advancesDeducted + line.otherDeductions,
        net: sum.net + line.netPay,
      }),
      { gross: 0, deductions: 0, net: 0 },
    );
  }, [payslips]);

  const createEmployee = useMutation({
    mutationFn: () => api.post<Employee>("/payroll/employees", {
      ...employeeForm,
      baseSalary: Number(employeeForm.baseSalary),
      paidLeavesPerMonth: Number(employeeForm.paidLeavesPerMonth || 0),
      status: "ACTIVE",
    }),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      setEmployeeForm({ name: "", phone: "", role: "Cashier", department: "Store", baseSalary: "", paidLeavesPerMonth: "0", salaryType: "MONTHLY", joinedAt: today() });
      setMessage("Employee added.");
    },
  });
  const markAttendance = useMutation({
    mutationFn: () => api.post<AttendanceRow>("/payroll/attendance", {
      ...attendanceForm,
      overtimeMinutes: Number(attendanceForm.overtimeMinutes || 0),
      note: attendanceForm.note || undefined,
    }),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      setMessage("Attendance saved.");
    },
  });
  const createAdvance = useMutation({
    mutationFn: () => api.post<PayAdvance>("/payroll/advances", {
      employeeId: advanceForm.employeeId,
      amount: Number(advanceForm.amount),
      reason: advanceForm.reason || undefined,
    }),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      setAdvanceForm({ employeeId: "", amount: "", reason: "" });
      setMessage("Advance requested.");
    },
  });
  const updateAdvanceStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<AdvanceStatus, "PENDING"> }) => api.patch<PayAdvance>(`/payroll/advances/${id}/status`, { status }),
    onSuccess: async () => invalidatePayroll(queryClient),
  });
  const createRun = useMutation({
    mutationFn: () => api.post<PayrollRun>("/payroll/runs", { period: runForm.period, notes: runForm.notes || undefined }),
    onSuccess: async (run) => {
      setSelectedRunId(run.id);
      await invalidatePayroll(queryClient);
      setMessage("Payroll run created.");
    },
  });
  const generateRun = useMutation({
    mutationFn: () => api.post(`/payroll/runs/${currentRunId}/generate`, {
      otherDeductions: Object.entries(deductionForm)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([employeeId, amount]) => ({ employeeId, amount: Number(amount) })),
    }),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      setMessage("Payslips generated.");
    },
  });
  const updateRunStatus = useMutation({
    mutationFn: (status: "APPROVED" | "PAID") => api.patch<PayrollRun>(`/payroll/runs/${currentRunId}/status`, { status }),
    onSuccess: async () => invalidatePayroll(queryClient),
  });
  const disburseRun = useMutation({
    mutationFn: () => api.post<{ data: PayrollDisbursement[] }>(`/payroll/runs/${currentRunId}/disburse`, {
      paymentMethodId: disburseForm.paymentMethodId,
      paidAt: disburseForm.paidAt,
      referencePrefix: disburseForm.referencePrefix || undefined,
    }),
    onSuccess: async (result) => {
      await invalidatePayroll(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["payment-method-statement"] });
      setMessage(`${String(result.data.length)} salary disbursements recorded.`);
    },
  });

  const error = [createEmployee, markAttendance, createAdvance, updateAdvanceStatus, createRun, generateRun, updateRunStatus, disburseRun].find((mutation) => mutation.error)?.error;

  function selectedEmployeeName(id: string) {
    return employees.find((employee) => employee.id === id)?.name ?? "Employee";
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${activeTab === tab.id ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div> : null}

      {activeTab === "employees" ? (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form onSubmit={(event) => { event.preventDefault(); createEmployee.mutate(); }} className="rounded-md border border-border bg-white p-4">
            <SectionTitle title="Add employee" subtitle="Base salary, paid leave allowance, and salary type drive payroll generation." />
            <div className="grid gap-3">
              <input value={employeeForm.name} onChange={(event) => setEmployeeForm((form) => ({ ...form, name: event.target.value }))} placeholder="Employee name" required className={inputClass} />
              <input value={employeeForm.phone} onChange={(event) => setEmployeeForm((form) => ({ ...form, phone: event.target.value }))} placeholder="Phone" required className={inputClass} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={employeeForm.role} onChange={(event) => setEmployeeForm((form) => ({ ...form, role: event.target.value }))} placeholder="Role" required className={inputClass} />
                <input value={employeeForm.department} onChange={(event) => setEmployeeForm((form) => ({ ...form, department: event.target.value }))} placeholder="Department" required className={inputClass} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="number" min="0" step="0.01" value={employeeForm.baseSalary} onChange={(event) => setEmployeeForm((form) => ({ ...form, baseSalary: event.target.value }))} placeholder="Base salary" required className={inputClass} />
                <select value={employeeForm.salaryType} onChange={(event) => setEmployeeForm((form) => ({ ...form, salaryType: event.target.value as SalaryType }))} className={inputClass}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="DAILY">Daily</option>
                  <option value="HOURLY">Hourly</option>
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="number" min="0" max="31" value={employeeForm.paidLeavesPerMonth} onChange={(event) => setEmployeeForm((form) => ({ ...form, paidLeavesPerMonth: event.target.value }))} placeholder="Paid leaves / month" className={inputClass} />
                <input type="date" value={employeeForm.joinedAt} onChange={(event) => setEmployeeForm((form) => ({ ...form, joinedAt: event.target.value }))} required className={inputClass} />
              </div>
              <button disabled={createEmployee.isPending} className={primaryButtonClass}><Plus className="size-4" />Add employee</button>
            </div>
          </form>
          <DataPanel title="Employees" empty={employees.length === 0 ? "No employees yet." : null}>
            <div className="divide-y divide-border">
              {employees.map((employee) => (
                <div key={employee.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_140px_140px_120px_140px] md:items-center">
                  <div>
                    <div className="font-medium text-slate-950">{employee.name}</div>
                    <div className="text-xs text-slate-500">{employee.phone} | {employee.role} | {employee.department}</div>
                    <div className="text-xs text-slate-500">Joined {formatDate(employee.joinedAt)} | Paid leaves {employee.paidLeavesPerMonth}/month</div>
                  </div>
                  <StatusPill value={employee.status} />
                  <div className="text-sm text-slate-700">{money(employee.baseSalary)}</div>
                  <div className="text-xs font-semibold text-slate-500">{employee.salaryType}</div>
                  <div className="text-xs text-slate-500">{formatDate(employee.joinedAt)}</div>
                </div>
              ))}
            </div>
          </DataPanel>
        </section>
      ) : null}

      {activeTab === "attendance" ? (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form onSubmit={(event) => { event.preventDefault(); markAttendance.mutate(); }} className="rounded-md border border-border bg-white p-4">
            <SectionTitle title="Mark attendance" subtitle="Save exceptions only if you want; days without rows are treated as present unless you explicitly record present rows for that period." />
            <EmployeeSelect value={attendanceForm.employeeId} employees={activeEmployees} onChange={(employeeId) => setAttendanceForm((form) => ({ ...form, employeeId }))} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="date" value={attendanceForm.date} onChange={(event) => setAttendanceForm((form) => ({ ...form, date: event.target.value }))} className={inputClass} />
              <select value={attendanceForm.status} onChange={(event) => setAttendanceForm((form) => ({ ...form, status: event.target.value as AttendanceStatus }))} className={inputClass}>
                {["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "ON_DUTY"].map((status) => <option key={status} value={status}>{label(status)}</option>)}
              </select>
              <input type="number" min="0" value={attendanceForm.overtimeMinutes} onChange={(event) => setAttendanceForm((form) => ({ ...form, overtimeMinutes: event.target.value }))} placeholder="Overtime minutes" className={inputClass} />
              <input value={attendanceForm.note} onChange={(event) => setAttendanceForm((form) => ({ ...form, note: event.target.value }))} placeholder="Note" className={inputClass} />
            </div>
            <button disabled={markAttendance.isPending || !attendanceForm.employeeId} className={`${primaryButtonClass} mt-3`}><Check className="size-4" />Save attendance</button>
          </form>
          <DataPanel title="Recent attendance" empty={(attendanceQuery.data?.data ?? []).length === 0 ? "No attendance rows yet." : null}>
            <Table headers={["Date", "Employee", "Status", "Overtime", "Note"]}>
              {(attendanceQuery.data?.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">{row.date}</td>
                  <td className="px-3 py-2">{row.employee?.name ?? selectedEmployeeName(row.employeeId)}</td>
                  <td className="px-3 py-2"><StatusPill value={label(row.status)} /></td>
                  <td className="px-3 py-2">{row.overtimeMinutes} min</td>
                  <td className="px-3 py-2 text-slate-500">{row.note || "-"}</td>
                </tr>
              ))}
            </Table>
          </DataPanel>
        </section>
      ) : null}

      {activeTab === "advances" ? (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form onSubmit={(event) => { event.preventDefault(); createAdvance.mutate(); }} className="rounded-md border border-border bg-white p-4">
            <SectionTitle title="Pay advance" subtitle="Approved advances are recovered in generated payroll." />
            <EmployeeSelect value={advanceForm.employeeId} employees={activeEmployees} onChange={(employeeId) => setAdvanceForm((form) => ({ ...form, employeeId }))} />
            <input type="number" min="0.01" step="0.01" value={advanceForm.amount} onChange={(event) => setAdvanceForm((form) => ({ ...form, amount: event.target.value }))} placeholder="Amount" required className={`${inputClass} mt-3`} />
            <input value={advanceForm.reason} onChange={(event) => setAdvanceForm((form) => ({ ...form, reason: event.target.value }))} placeholder="Reason" className={`${inputClass} mt-3`} />
            <button disabled={createAdvance.isPending || !advanceForm.employeeId} className={`${primaryButtonClass} mt-3`}><Plus className="size-4" />Record advance</button>
          </form>
          <DataPanel title="Advance requests" empty={(advancesQuery.data?.data ?? []).length === 0 ? "No advances yet." : null}>
            <Table headers={["Employee", "Amount", "Status", "Requested", "Action"]}>
              {(advancesQuery.data?.data ?? []).map((advance) => (
                <tr key={advance.id} className="border-t border-border">
                  <td className="px-3 py-2">{advance.employee?.name ?? selectedEmployeeName(advance.employeeId)}</td>
                  <td className="px-3 py-2 font-semibold">{money(advance.amount)}</td>
                  <td className="px-3 py-2"><StatusPill value={advance.status} /></td>
                  <td className="px-3 py-2">{new Date(advance.requestedAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2">
                    {advance.status === "PENDING" ? (
                      <div className="flex gap-2">
                        <button onClick={() => updateAdvanceStatus.mutate({ id: advance.id, status: "APPROVED" })} className={smallButtonClass}>Approve</button>
                        <button onClick={() => updateAdvanceStatus.mutate({ id: advance.id, status: "REJECTED" })} className={smallButtonClass}>Reject</button>
                      </div>
                    ) : <span className="text-xs text-slate-400">-</span>}
                  </td>
                </tr>
              ))}
            </Table>
          </DataPanel>
        </section>
      ) : null}

      {activeTab === "runs" ? (
        <section className="grid gap-4 xl:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <form onSubmit={(event) => { event.preventDefault(); createRun.mutate(); }} className="rounded-md border border-border bg-white p-4">
              <SectionTitle title="Create run" subtitle="Use YYYY-MM period." />
              <input type="month" value={runForm.period} onChange={(event) => setRunForm((form) => ({ ...form, period: event.target.value }))} className={inputClass} />
              <input value={runForm.notes} onChange={(event) => setRunForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Notes" className={`${inputClass} mt-3`} />
              <button className={`${primaryButtonClass} mt-3`}><Plus className="size-4" />Create run</button>
            </form>
            <DataPanel title="Runs" empty={runs.length === 0 ? "No payroll runs yet." : null}>
              <div className="divide-y divide-border">
                {runs.map((run) => (
                  <button key={run.id} onClick={() => setSelectedRunId(run.id)} className={`w-full px-4 py-3 text-left text-sm ${runId === run.id ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-950">{run.period}</span>
                      <StatusPill value={run.status} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{run.counts?.payslipLines ?? 0} payslips</div>
                  </button>
                ))}
              </div>
            </DataPanel>
          </div>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric title="Gross" value={money(payrollTotals.gross)} />
              <Metric title="Deductions" value={money(payrollTotals.deductions)} />
              <Metric title="Net payable" value={money(payrollTotals.net)} tone="emerald" />
            </div>
            <div className="rounded-md border border-border bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={!runId || generateRun.isPending || runDetail?.status !== "DRAFT"} onClick={() => generateRun.mutate()} className={primaryButtonClass}><RefreshCw className="size-4" />Generate payslips</button>
                <button disabled={!runId || runDetail?.status !== "DRAFT"} onClick={() => updateRunStatus.mutate("APPROVED")} className={secondaryButtonClass}><Check className="size-4" />Approve</button>
                <button onClick={() => setActiveTab("disbursements")} className={secondaryButtonClass}><Send className="size-4" />Disburse</button>
              </div>
            </div>
            <DataPanel title="Payslips" empty={payslips.length === 0 ? "Generate payslips for the selected run." : null}>
              <Table headers={["Employee", "Worked", "Gross", "Advances", "Other", "Net"]}>
                {payslips.map((line) => (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-2">{line.employee?.name ?? selectedEmployeeName(line.employeeId)}</td>
                    <td className="px-3 py-2">{line.daysWorked} d / {line.overtimeHours} h</td>
                    <td className="px-3 py-2">{money(line.grossPay + line.overtimePay)}</td>
                    <td className="px-3 py-2">{money(line.advancesDeducted)}</td>
                    <td className="px-3 py-2">
                      {runDetail?.status === "DRAFT" ? (
                        <input value={deductionForm[line.employeeId] ?? String(line.otherDeductions || "")} onChange={(event) => setDeductionForm((form) => ({ ...form, [line.employeeId]: event.target.value }))} className="h-8 w-24 rounded-md border border-border px-2 text-sm" />
                      ) : money(line.otherDeductions)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-emerald-700">{money(line.netPay)}</td>
                  </tr>
                ))}
              </Table>
            </DataPanel>
          </div>
        </section>
      ) : null}

      {activeTab === "disbursements" ? (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form onSubmit={(event) => { event.preventDefault(); disburseRun.mutate(); }} className="rounded-md border border-border bg-white p-4">
            <SectionTitle title="Disburse selected run" subtitle="This records one salary payout per unpaid payslip." />
            <select value={selectedRunId ?? runId ?? ""} onChange={(event) => setSelectedRunId(event.target.value)} className={inputClass}>
              {runs.map((run) => <option key={run.id} value={run.id}>{run.period} - {run.status}</option>)}
            </select>
            <select value={disburseForm.paymentMethodId} onChange={(event) => setDisburseForm((form) => ({ ...form, paymentMethodId: event.target.value }))} className={`${inputClass} mt-3`}>
              <option value="">Select payment method</option>
              {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name} ({method.short_code})</option>)}
            </select>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="date" value={disburseForm.paidAt} onChange={(event) => setDisburseForm((form) => ({ ...form, paidAt: event.target.value }))} className={inputClass} />
              <input value={disburseForm.referencePrefix} onChange={(event) => setDisburseForm((form) => ({ ...form, referencePrefix: event.target.value }))} placeholder="Reference prefix" className={inputClass} />
            </div>
            <button disabled={!runId || !disburseForm.paymentMethodId || runDetail?.status === "DRAFT" || disburseRun.isPending} className={`${primaryButtonClass} mt-3`}><Send className="size-4" />Record disbursement</button>
          </form>
          <DataPanel title="Disbursement history" empty={(disbursementsQuery.data?.data ?? []).length === 0 ? "No salary disbursements yet." : null}>
            <Table headers={["Paid at", "Employee", "Run", "Method", "Amount", "Reference"]}>
              {(disbursementsQuery.data?.data ?? []).map((row) => (
                <tr key={row.id} className={`border-t border-border ${row.voidedAt ? "text-slate-400 line-through" : ""}`}>
                  <td className="px-3 py-2">{new Date(row.paidAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2">{row.employee?.name ?? "-"}</td>
                  <td className="px-3 py-2">{row.payrollRun?.period ?? "-"}</td>
                  <td className="px-3 py-2">{row.paymentMethod?.name ?? "-"}</td>
                  <td className="px-3 py-2 font-semibold">{money(row.amount)}</td>
                  <td className="px-3 py-2 text-slate-500">{row.referenceNumber ?? "-"}</td>
                </tr>
              ))}
            </Table>
          </DataPanel>
        </section>
      ) : null}
    </div>
  );
}

async function invalidatePayroll(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["payroll"] }),
    queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
  ]);
}

function EmployeeSelect({ value, employees, onChange }: Readonly<{ value: string; employees: Employee[]; onChange: (employeeId: string) => void }>) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} required className={inputClass}>
      <option value="">Select employee</option>
      {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.department}</option>)}
    </select>
  );
}

function SectionTitle({ title, subtitle }: Readonly<{ title: string; subtitle: string }>) {
  return (
    <div className="mb-3">
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
    </div>
  );
}

function DataPanel({ title, empty, children }: Readonly<{ title: string; empty: string | null; children: React.ReactNode }>) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">{title}</div>
      {empty ? <div className="p-5 text-sm text-slate-500">{empty}</div> : children}
    </div>
  );
}

function Table({ headers, children }: Readonly<{ headers: string[]; children: React.ReactNode }>) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Metric({ title, value, tone = "slate" }: Readonly<{ title: string; value: string; tone?: "slate" | "emerald" }>) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase text-slate-500">{title}</div>
      <div className={`mt-2 text-xl font-semibold ${tone === "emerald" ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function StatusPill({ value }: Readonly<{ value: string }>) {
  return <span className="inline-flex w-fit rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{label(value)}</span>;
}

function label(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: number) {
  return `Rs ${(value || 0).toFixed(2)}`;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const inputClass = "h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-500";
const primaryButtonClass = "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
const smallButtonClass = "h-8 rounded-md border border-border px-3 text-xs font-semibold text-slate-700";
