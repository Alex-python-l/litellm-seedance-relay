"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { copyButtonLabel, copyTextStatus, type CopyStatus } from "@/lib/clipboard";
import { ApiKey, Money, relayFetch } from "@/lib/http/publicRelay";
import { migratedHref } from "@/utils/migratedPages";
import { usePortal } from "./PortalContext";

type Section = "overview" | "keys" | "credit" | "usage" | "logs" | "videos" | "security";
type Wallet = { available: Money; reserved: Money };
type Usage = {
  request_count: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  charged: Money;
  upstream_cost: Money;
};
type LedgerEntry = {
  entry_id: string;
  entry_type: string;
  amount: Money;
  request_id: string | null;
  created_at: string;
};
type Price = { price_id: string; model_name: string; output_micros_per_million: number | null };
type RequestLog = {
  request_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  charged: Money;
  status: string | null;
  created_at: string;
};
type VideoTask = {
  id: string;
  task_id: string | null;
  model: string;
  status: string;
  duration: number;
  resolution: string;
  ratio: string;
  estimated_tokens: number;
  actual_tokens: number | null;
  charged: Money;
  created_at: string;
};

const titles: Record<Section, [string, string]> = {
  overview: ["概览", "查看企业余额和中转调用情况。"],
  keys: ["API Key", "创建仅能访问已开放模型与 Seedance 接口的企业 Key。"],
  credit: ["额度与账目", "查看可用额度、预占额度、统一价格和账目流水。"],
  usage: ["用量", "查看企业账户的 Token 消耗和累计收费。"],
  logs: ["请求记录", "查看大模型请求记录，不展示明文提示词。"],
  videos: ["视频任务", "查看 Seedance 2.0 任务状态、规格、实际 Token 和收费。"],
  security: ["账户安全", "管理当前企业门户登录会话。"],
};

export default function PortalPage({ section }: { section: Section }) {
  const [title, subtitle] = titles[section];
  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#d83a20]">企业门户</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">{title}</h1>
      <p className="mt-3 text-black/55">{subtitle}</p>
      <div className="mt-9">
        {section === "overview" && <Overview />}
        {section === "keys" && <Keys />}
        {section === "credit" && <Credit />}
        {section === "usage" && <UsageView />}
        {section === "logs" && <Logs />}
        {section === "videos" && <Videos />}
        {section === "security" && <Security />}
      </div>
    </div>
  );
}

function Overview() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    Promise.all([relayFetch<Wallet>("/v1/portal/wallet"), relayFetch<Usage>("/v1/portal/usage")]).then(
      ([walletResult, usageResult]) => {
        setWallet(walletResult.data);
        setUsage(usageResult.data);
      },
    );
  }, []);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="可用额度" value={wallet?.available.display ?? "—"} accent />
      <Metric label="任务预占" value={wallet?.reserved.display ?? "—"} />
      <Metric label="累计请求" value={usage?.request_count.toLocaleString() ?? "—"} />
      <Card className="md:col-span-3">
        <p className="text-sm text-black/45">Seedance 2.0 创建任务</p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-[#171713] p-5 text-xs leading-6 text-white/80">
          <code>{`curl -X POST "$RELAY_URL/api/v1/open/contents/generations/tasks" \\
  -H "Authorization: Bearer $RELAY_API_KEY" \\
  -H "Idempotency-Key: your-unique-request-id" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"doubao-seedance-2-0-260128","content":[{"type":"text","text":"A cinematic sunrise"}],"duration":5,"resolution":"720p","ratio":"16:9"}'`}</code>
        </pre>
      </Card>
    </div>
  );
}

function Keys() {
  const { csrfToken } = usePortal();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [alias, setAlias] = useState("");
  const [newKey, setNewKey] = useState("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    relayFetch<{ data: ApiKey[] }>("/v1/portal/keys")
      .then(({ data }) => setKeys(data.data))
      .catch((requestError: Error) => setError(requestError.message));
  }, []);
  useEffect(load, [load]);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const { data } = await relayFetch<ApiKey>(
        "/v1/portal/keys",
        { method: "POST", body: JSON.stringify({ alias, log_content: false }) },
        csrfToken,
      );
      setNewKey(data.key ?? "");
      setCopyStatus("idle");
      setAlias("");
      load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建 Key 失败");
    }
  }
  async function remove(keyId: string) {
    await relayFetch(`/v1/portal/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }, csrfToken);
    load();
  }
  async function copyNewKey() {
    setCopyStatus(await copyTextStatus(newKey));
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
      <Card>
        <form onSubmit={create}>
          <h2 className="text-lg font-semibold">创建 API Key</h2>
          <label className="mt-5 block text-sm">
            备注名
            <input
              required
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className="mt-2 w-full rounded-xl border-black/15"
            />
          </label>
          <button className="mt-6 rounded-full bg-[#11110f] px-5 py-2.5 text-sm text-white">创建</button>
          {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        </form>
      </Card>
      <div className="space-y-3">
        {newKey && (
          <Card className="bg-[#d9e8ff]">
            <p className="text-sm font-medium">Key 仅显示一次，请立即保存</p>
            <code className="mt-3 block overflow-x-auto text-sm">{newKey}</code>
            <button
              type="button"
              onClick={() => void copyNewKey()}
              className="mt-4 rounded-full bg-black px-4 py-2 text-xs text-white"
            >
              {copyButtonLabel(copyStatus, "复制")}
            </button>
            {copyStatus === "failed" && <p className="mt-3 text-xs text-red-700">请手动选择并复制上方 Key。</p>}
          </Card>
        )}
        {keys.map((key) => (
          <Card key={key.key_id} className="flex items-center justify-between">
            <div>
              <p className="font-medium">{key.alias || "未命名 Key"}</p>
              <p className="mt-1 font-mono text-xs text-black/40">{key.key_id.slice(0, 16)}…</p>
            </div>
            <button type="button" onClick={() => void remove(key.key_id)} className="text-sm text-red-700">
              删除
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Credit() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  useEffect(() => {
    Promise.all([
      relayFetch<Wallet>("/v1/portal/wallet"),
      relayFetch<{ data: LedgerEntry[] }>("/v1/portal/ledger"),
      relayFetch<{ models: Price[] }>("/v1/portal/pricing"),
    ]).then(([walletResult, ledgerResult, priceResult]) => {
      setWallet(walletResult.data);
      setLedger(ledgerResult.data.data);
      setPrices(priceResult.data.models);
    });
  }, []);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold">当前额度</h2>
        <p className="mt-5 text-4xl font-semibold">{wallet?.available.display ?? "—"}</p>
        <p className="mt-2 text-sm text-black/45">预占 {wallet?.reserved.display ?? "—"}</p>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">统一价格</h2>
        <div className="mt-5 divide-y">
          {prices.map((price) => (
            <div key={price.price_id} className="flex justify-between py-4 text-sm">
              <span>{price.model_name}</span>
              <span className="font-mono text-xs text-black/55">
                {price.output_micros_per_million ?? 0} 微美元/百万 Token
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <h2 className="text-lg font-semibold">账目流水</h2>
        <div className="mt-5 divide-y">
          {ledger.map((entry) => (
            <div key={entry.entry_id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
              <span>
                {entry.entry_type}
                {entry.request_id ? ` · ${entry.request_id.slice(0, 12)}…` : ""}
              </span>
              <span>
                {entry.amount.display} · {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function UsageView() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    void relayFetch<Usage>("/v1/portal/usage").then(({ data }) => setUsage(data));
  }, []);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="请求数" value={usage?.request_count.toLocaleString() ?? "—"} />
      <Metric label="输入 Token" value={usage?.input_tokens.toLocaleString() ?? "—"} />
      <Metric label="生成 Token" value={usage?.output_tokens.toLocaleString() ?? "—"} />
      <Metric label="累计收费" value={usage?.charged.display ?? "—"} accent />
    </div>
  );
}

function Logs() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  useEffect(() => {
    void relayFetch<{ data: RequestLog[] }>("/v1/portal/logs").then(({ data }) => setLogs(data.data));
  }, []);
  return (
    <Card>
      <Table headers={["请求 ID", "模型", "状态", "Token", "收费", "时间"]}>
        {logs.map((log) => (
          <tr key={log.request_id} className="border-t">
            <td className="py-3 font-mono text-xs">{log.request_id.slice(0, 14)}…</td>
            <td>{log.model}</td>
            <td>{log.status ?? "—"}</td>
            <td>{(log.input_tokens + log.output_tokens).toLocaleString()}</td>
            <td>{log.charged.display}</td>
            <td>{new Date(log.created_at).toLocaleString()}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Videos() {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  useEffect(() => {
    void relayFetch<{ data: VideoTask[] }>("/v1/portal/video-tasks").then(({ data }) => setTasks(data.data));
  }, []);
  return (
    <Card>
      <Table headers={["任务 ID", "规格", "状态", "实际 Token", "收费", "时间"]}>
        {tasks.map((task) => (
          <tr key={task.id} className="border-t">
            <td className="max-w-48 truncate py-3 font-mono text-xs" title={task.id}>
              {task.id}
            </td>
            <td>
              {task.duration}s · {task.resolution} · {task.ratio}
            </td>
            <td>{task.status}</td>
            <td>{task.actual_tokens?.toLocaleString() ?? "—"}</td>
            <td>{task.charged.display}</td>
            <td>{new Date(task.created_at).toLocaleString()}</td>
          </tr>
        ))}
      </Table>
      {tasks.length === 0 && <p className="py-8 text-center text-sm text-black/40">还没有视频任务</p>}
    </Card>
  );
}

function Security() {
  const { csrfToken } = usePortal();
  const router = useRouter();
  async function logout() {
    await relayFetch("/v1/public/auth/logout", { method: "POST" }, csrfToken);
    router.push(migratedHref("relay-login"));
  }
  return (
    <Card>
      <h2 className="text-lg font-semibold">当前会话</h2>
      <p className="mt-3 text-sm text-black/55">退出后需要重新使用企业管理员邮箱和密码登录。</p>
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-6 rounded-full bg-black px-5 py-2.5 text-sm text-white"
      >
        退出登录
      </button>
    </Card>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-black/10 bg-white p-6 ${className}`}>{children}</div>;
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-3xl p-6 ${accent ? "bg-[#ff4f2e] text-white" : "border border-black/10 bg-white"}`}>
      <p className="text-sm opacity-55">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="text-xs text-black/45">
          <tr>
            {headers.map((header) => (
              <th key={header} className="pb-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
