"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { copyButtonLabel, copyTextStatus, type CopyStatus } from "@/lib/clipboard";
import { Money, relayFetch } from "@/lib/http/publicRelay";

type Account = {
  account_id: string;
  company_name: string;
  email: string;
  status: string;
  wallet_id: string;
  available: Money;
  reserved: Money;
};

type Price = {
  price_id: string;
  model_name: string;
  version: number;
  input_micros_per_million: number;
  output_micros_per_million: number | null;
};

type VideoTask = {
  id: string;
  task_id: string | null;
  account_id: string;
  company_name: string;
  email: string;
  status: string;
  duration: number;
  resolution: string;
  ratio: string;
  actual_tokens: number | null;
  charged: Money;
  created_at: string;
};

type Provider = {
  configured: boolean;
  connected: boolean | null;
  model: string;
  api_base_url: string;
  upstream_micros_per_million: number;
  detail: string | null;
};

type LinkResult = { url: string; expires_at: string };
type Margin = { charged: Money; upstream_cost: Money; gross_margin: Money };
const seedanceModel = "doubao-seedance-2-0-260128";

export default function RelayAdmin() {
  const { accessToken } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [margin, setMargin] = useState<Margin | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [initialCredit, setInitialCredit] = useState(0);
  const [notes, setNotes] = useState("");
  const [issuedLink, setIssuedLink] = useState("");
  const [model, setModel] = useState(seedanceModel);
  const [inputRate, setInputRate] = useState(0);
  const [outputRate, setOutputRate] = useState(5_000_000);
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState(100);
  const [adjustmentReason, setAdjustmentReason] = useState("企业额度充值");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const { data } = await relayFetch<T>(path, {
        ...init,
        headers: { authorization: `Bearer ${accessToken}`, ...init.headers },
      });
      return data;
    },
    [accessToken],
  );

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError("");
    try {
      const [accountResult, priceResult, taskResult, marginResult, providerResult] = await Promise.all([
        request<{ data: Account[] }>("/v1/admin/relay/accounts"),
        request<{ models: Price[] }>("/v1/admin/relay/prices"),
        request<{ data: VideoTask[] }>("/v1/admin/relay/video-tasks?limit=50"),
        request<Margin>("/v1/admin/relay/margin"),
        request<Provider>("/v1/admin/relay/providers/seedance"),
      ]);
      setAccounts(accountResult.data);
      setPrices(priceResult.models);
      setTasks(taskResult.data);
      setMargin(marginResult);
      setProvider(providerResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法加载中转站管理数据");
    }
  }, [accessToken, request]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action);
    setError("");
    try {
      await work();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  async function createEnterprise(event: FormEvent) {
    event.preventDefault();
    await run("create-account", async () => {
      const payload = {
        company_name: companyName,
        admin_email: adminEmail,
        initial_credit_micros: Math.round(initialCredit * 1_000_000),
        notes: notes || null,
      };
      const result = await request<{ activation: LinkResult }>("/v1/admin/relay/accounts", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      setIssuedLink(result.activation.url);
      setCompanyName("");
      setAdminEmail("");
      setInitialCredit(0);
      setNotes("");
      await load();
    });
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    await run("publish-price", async () => {
      const payload = {
        model_name: model,
        input_micros_per_million: inputRate,
        cached_input_micros_per_million: null,
        output_micros_per_million: outputRate,
        embedding_micros_per_million: null,
        default_max_output_tokens: 250000,
        max_output_tokens: 8000000,
        enabled: true,
      };
      await request("/v1/admin/relay/prices", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await load();
    });
  }

  async function testProvider() {
    await run("test-provider", async () => {
      const result = await request<Provider>("/v1/admin/relay/providers/seedance/test", { method: "POST" });
      setProvider(result);
    });
  }

  async function issueLink(account: Account, kind: "activation-link" | "password-reset-link") {
    await run(`link-${account.account_id}`, async () => {
      const result = await request<LinkResult>(`/v1/admin/relay/accounts/${account.account_id}/${kind}`, {
        method: "POST",
      });
      setIssuedLink(result.url);
    });
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!adjusting) return;
    const amountMicros = Math.round(adjustmentAmount * 1_000_000);
    await run("adjust-wallet", async () => {
      await request(`/v1/admin/relay/wallets/${adjusting.wallet_id}/adjust`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ amount_micros: amountMicros, reason: adjustmentReason }),
      });
      setAdjusting(null);
      await load();
    });
  }

  async function toggle(account: Account) {
    await run(`toggle-${account.account_id}`, async () => {
      await request(`/v1/admin/relay/accounts/${account.account_id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: account.status === "ACTIVE" ? "FROZEN" : "ACTIVE" }),
      });
      await load();
    });
  }

  return (
    <div className="mx-auto max-w-7xl p-6 text-gray-950">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-sm text-gray-500">企业中转站</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">运营管理</h1>
        </div>
        <div className="flex gap-6 text-right text-sm">
          <Summary label="企业收费" value={margin?.charged.display ?? "—"} />
          <Summary label="上游成本" value={margin?.upstream_cost.display ?? "—"} />
          <Summary label="毛利" value={margin?.gross_margin.display ?? "—"} />
        </div>
      </div>

      {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {issuedLink && <IssuedLink key={issuedLink} value={issuedLink} onClose={() => setIssuedLink("")} />}

      <Panel title="Seedance 2.0 上游" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <StatusDot ok={provider?.connected ?? provider?.configured ?? false} />
              <p className="font-medium">{providerStatusLabel(provider)}</p>
            </div>
            <p className="mt-2 text-xs text-gray-500">{provider?.model ?? seedanceModel}</p>
            {provider?.detail && <p className="mt-2 text-xs text-gray-500">{provider.detail}</p>}
          </div>
          <Action onClick={() => void testProvider()} disabled={busy === "test-provider"}>
            {busy === "test-provider" ? "测试中…" : "测试连接"}
          </Action>
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="创建企业账户">
          <form onSubmit={createEnterprise} className="grid gap-4">
            <Field required placeholder="企业名称" value={companyName} onChange={setCompanyName} />
            <Field required type="email" placeholder="管理员邮箱" value={adminEmail} onChange={setAdminEmail} />
            <NumberField
              label="初始额度（USD）"
              value={initialCredit}
              onChange={setInitialCredit}
              min={0}
              step="0.01"
            />
            <textarea
              placeholder="备注（可选）"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="rounded-lg border-gray-200"
            />
            <Primary disabled={busy === "create-account"}>创建并生成激活链接</Primary>
          </form>
        </Panel>

        <Panel title="发布统一价格">
          <form onSubmit={publish} className="grid gap-4">
            <Field required placeholder="模型名称" value={model} onChange={setModel} />
            <NumberField label="输入价（微美元/百万 Token）" value={inputRate} onChange={setInputRate} min={0} />
            <NumberField label="生成价（微美元/百万 Token）" value={outputRate} onChange={setOutputRate} min={0} />
            <Primary disabled={busy === "publish-price"}>发布新价格版本</Primary>
          </form>
          <div className="mt-5 divide-y">
            {prices.map((price) => (
              <p key={price.price_id} className="flex justify-between py-3 text-sm">
                <span>
                  {price.model_name} · v{price.version}
                </span>
                <span className="font-mono text-xs text-gray-500">{price.output_micros_per_million ?? 0}</span>
              </p>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="企业账户" className="mt-6">
        {accounts.length === 0 && <Empty>还没有企业账户</Empty>}
        {accounts.map((account) => (
          <div key={account.account_id} className="border-b py-4 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{account.company_name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {account.email} · 可用 {account.available.display} · 预占 {account.reserved.display} ·{" "}
                  {account.status}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {account.status === "INVITED" && (
                  <Action
                    onClick={() => void issueLink(account, "activation-link")}
                    disabled={busy === `link-${account.account_id}`}
                  >
                    {busy === `link-${account.account_id}` ? "生成中…" : "激活链接"}
                  </Action>
                )}
                {account.status === "ACTIVE" && (
                  <Action
                    onClick={() => void issueLink(account, "password-reset-link")}
                    disabled={busy === `link-${account.account_id}`}
                  >
                    {busy === `link-${account.account_id}` ? "生成中…" : "重置密码"}
                  </Action>
                )}
                <Action onClick={() => setAdjusting(adjusting?.account_id === account.account_id ? null : account)}>
                  调整额度
                </Action>
                {account.status !== "INVITED" && (
                  <Action onClick={() => void toggle(account)}>{account.status === "ACTIVE" ? "冻结" : "启用"}</Action>
                )}
              </div>
            </div>
            {adjusting?.account_id === account.account_id && (
              <form onSubmit={submitAdjustment} className="mt-4 grid gap-3 rounded-xl bg-gray-50 p-4 md:grid-cols-3">
                <NumberField
                  label="金额（USD，扣减填负数）"
                  value={adjustmentAmount}
                  onChange={setAdjustmentAmount}
                  step="0.01"
                />
                <Field required placeholder="调整原因" value={adjustmentReason} onChange={setAdjustmentReason} />
                <Primary disabled={busy === "adjust-wallet"}>确认调整</Primary>
              </form>
            )}
          </div>
        ))}
      </Panel>

      <Panel title="Seedance 视频任务" className="mt-6">
        {tasks.length === 0 && <Empty>还没有视频任务</Empty>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b text-xs text-gray-500">
              <tr>
                <th className="py-3">企业</th>
                <th>任务 ID</th>
                <th>规格</th>
                <th>状态</th>
                <th>实际 Token</th>
                <th>收费</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td className="py-3">
                    <p className="font-medium">{task.company_name}</p>
                    <p className="text-xs text-gray-400">{task.email}</p>
                  </td>
                  <td className="max-w-52 truncate font-mono text-xs" title={task.id}>
                    {task.id}
                  </td>
                  <td>
                    {task.duration}s · {task.resolution} · {task.ratio}
                  </td>
                  <td>
                    <StatusPill value={task.status} />
                  </td>
                  <td>{task.actual_tokens?.toLocaleString() ?? "—"}</td>
                  <td>{task.charged.display}</td>
                  <td>{new Date(task.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function IssuedLink({ value, onClose }: { value: string; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  async function copy() {
    setCopyStatus(await copyTextStatus(value));
  }

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/45 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="issued-link-title"
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
      >
        <p id="issued-link-title" className="text-lg font-semibold">
          一次性账户链接已生成
        </p>
        <p className="mt-2 text-sm text-gray-600">请立即复制，并通过安全渠道发送给对应账户。</p>
        <code className="mt-4 block max-h-32 overflow-auto break-all rounded-xl bg-blue-50 p-4 text-xs">{value}</code>
        <div className="mt-4 flex flex-wrap gap-3">
          <Action onClick={() => void copy()}>{copyButtonLabel(copyStatus, "复制链接")}</Action>
          <Action onClick={onClose}>关闭</Action>
        </div>
        {copyStatus === "failed" && <p className="mt-2 text-xs text-red-700">请手动选择并复制上方链接。</p>}
      </section>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-6 ${className}`}>
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Action({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Primary({ children, disabled = false }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      className="self-end rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Field({
  value,
  onChange,
  type = "text",
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      {...props}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border-gray-200"
    />
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-gray-500">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-lg border-gray-200 text-sm text-black"
      />
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`size-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />;
}

function StatusPill({ value }: { value: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs ${statusTone(value)}`}>{value}</span>;
}

function providerStatusLabel(provider: Provider | null): string {
  if (provider?.connected === true) return "连接正常";
  if (provider?.configured) return "已配置，等待测试";
  return "尚未配置";
}

function statusTone(value: string): string {
  const normalized = value.toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized)) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (["failed", "cancelled", "canceled", "expired", "error"].includes(normalized)) {
    return "bg-red-50 text-red-700";
  }
  return "bg-amber-50 text-amber-700";
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-gray-400">{children}</p>;
}
