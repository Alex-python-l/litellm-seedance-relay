export default function DocsPage() {
  return (
    <main className="mx-auto min-h-[72vh] max-w-5xl px-5 py-16 lg:px-8">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#d83a20]">快速开始</p>
      <h1 className="mt-5 text-5xl font-semibold tracking-[-0.045em]">接入企业中转站</h1>
      <div className="mt-12 grid gap-8 lg:grid-cols-[.65fr_1.35fr]">
        <ol className="space-y-5 text-sm leading-6 text-black/65">
          <li>1. 管理员创建企业账户并发送一次性激活链接。</li>
          <li>2. 企业管理员完成激活，在门户中创建 API Key。</li>
          <li>3. 管理员为企业账户授予额度并发布模型价格。</li>
          <li>4. 使用企业 API Key 调用大模型或 Seedance 2.0。</li>
        </ol>
        <pre className="overflow-x-auto rounded-3xl bg-[#171713] p-7 text-sm leading-7 text-white/80">
          <code>{`curl -X POST "$RELAY_URL/api/v1/open/contents/generations/tasks" \\
  -H "Authorization: Bearer $RELAY_API_KEY" \\
  -H "Idempotency-Key: video-20260806-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "content": [{"type": "text", "text": "A paper boat sailing through a neon city"}],
    "duration": 5,
    "resolution": "720p",
    "ratio": "16:9"
  }'

curl "$RELAY_URL/api/v1/open/contents/generations/tasks/$TASK_ID" \\
  -H "Authorization: Bearer $RELAY_API_KEY"`}</code>
        </pre>
      </div>
    </main>
  );
}
