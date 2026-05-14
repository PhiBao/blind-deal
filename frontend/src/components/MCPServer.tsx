import { useState } from 'react';
import { useAccount } from 'wagmi';

interface MCPServerProps {
  onNavigate: (page: 'dashboard' | 'create' | 'mcp') => void;
  currentPage: string;
}

interface ToolResult {
  name: string;
  args?: Record<string, unknown>;
  status: 'idle' | 'loading' | 'success' | 'error';
  response: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _importMeta = import.meta as any;
// VITE_MCP_ENDPOINT overrides; fallback to Render URL (CORS enabled).
// Local dev: Render URL works (CORS allows it) OR Vite proxy at /mcp.
const MCP_ENDPOINT = (_importMeta.env && _importMeta.env.VITE_MCP_ENDPOINT) || 'https://blind-deal.onrender.com/mcp';

async function mcpCall(method: string, params: object = {}) {
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });

  const text = await res.text();
  // Parse SSE format: "event: message\ndata: {...}"
  const match = text.match(/data:\s*(\{.*\})/s);
  if (match) {
    const data = JSON.parse(match[1]);
    if (data.error) return { error: data.error };
    return data.result;
  }
  return { error: { message: text.slice(0, 200) } };
}

const TOOL_TESTS = [
  { name: 'tools/list', label: 'List Tools', desc: 'List all available MCP tools' },
  { name: 'resources/list', label: 'List Resources', desc: 'List all available resources' },
  { name: 'get_deal', label: 'Get Deal #0', desc: 'Fetch deal 0 state and parties', args: { dealId: 0 } },
  { name: 'list_deals', label: 'List Recent Deals', desc: 'List latest marketplace deals', args: { limit: 5 } },
  { name: 'get_events', label: 'Get Recent Events', desc: 'Fetch latest contract events', args: { fromBlock: 0 } },
];

export function MCPServer({ onNavigate, currentPage }: MCPServerProps) {
  const { isConnected } = useAccount();
  const [results, setResults] = useState<Record<string, ToolResult>>({});
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  const runTest = async (name: string, args?: Record<string, unknown>) => {
    setResults(prev => ({ ...prev, [name]: { name, args, status: 'loading', response: '' } }));

    try {
      // For tools/list and resources/list, send the method directly.
      // For other tools, wrap in tools/call per MCP protocol.
      const method = (name === 'tools/list' || name === 'resources/list') ? name : 'tools/call';
      const params = (name === 'tools/list' || name === 'resources/list') ? {} : { name, arguments: args ?? {} };

      const result: any = await mcpCall(method, params);
      const r = result as any;
      if (r?.error) {
        setResults(prev => ({ ...prev, [name]: { name, args, status: 'error', response: String(r.error.message) } }));
      } else {
        // Success — extract text from tools/call content, or serialize the whole result
        let display: string;
        if (r?.content && r.content[0] && r.content[0].text) {
          display = String(r.content[0].text);
        } else {
          display = JSON.stringify(r, null, 2);
        }
        try { display = JSON.stringify(JSON.parse(display), null, 2); } catch {}
        setResults(prev => ({ ...prev, [name]: { name, args, status: 'success', response: display } }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults(prev => ({ ...prev, [name]: { name, args, status: 'error', response: msg } }));
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3 3 0 012.9-1.9h8.63a3 3 0 012.9 1.9l1.573 1.06a4.5 4.5 0 01.9 2.7m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3 3 0 012.9-1.9h8.63a3 3 0 012.9 1.9l1.573 1.06a4.5 4.5 0 01.9 2.7m-19.5 0v1.5a3 3 0 003 3h13.5v-3.75a4.5 4.5 0 10-9 0v1.5h-4.5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">MCP Server</h1>
            <p className="text-sm text-slate-400">Model Context Protocol for AI agent integration</p>
          </div>
        </div>
      </div>

      {/* Server Info */}
      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Server Info</h2>
          <span className="text-xs text-emerald-400">Active</span>
        </div>

        <div className="space-y-3">
          <div className="p-3 bg-white/[0.03] rounded-lg">
            <p className="text-xs text-slate-500 mb-0.5">HTTP Endpoint</p>
            <p className="text-sm font-mono text-white">{MCP_ENDPOINT}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Tools', value: '6' },
              { label: 'Resources', value: '6' },
              { label: 'Prompts', value: '0' },
            ].map((stat) => (
              <div key={stat.label} className="p-3 bg-white/[0.03] rounded-lg text-center">
                <p className="text-lg font-semibold text-white">{stat.value}</p>
                <p className="text-[11px] text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Test Tools */}
      <div className="glass rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Test Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOL_TESTS.map((tool) => {
            const result = results[tool.name];
            const isLoading = result?.status === 'loading';

            return (
              <div key={tool.name} className="space-y-2">
                <button
                  onClick={() => runTest(tool.name, tool.args)}
                  disabled={isLoading}
                  className="w-full flex items-center gap-3 p-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    result?.status === 'success' ? 'bg-emerald-500/10' :
                    result?.status === 'error' ? 'bg-red-500/10' :
                    'bg-violet-500/10'
                  }`}>
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                    ) : result?.status === 'success' ? (
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : result?.status === 'error' ? (
                      <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{tool.label}</p>
                    <p className="text-[11px] text-slate-500 truncate">{tool.desc}</p>
                  </div>
                </button>

                {result && (
                  <button
                    onClick={() => setExpandedResult(expandedResult === tool.name ? null : tool.name)}
                    className="w-full text-left p-2 bg-black/20 rounded-lg border border-white/[0.04]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-mono ${
                        result.status === 'success' ? 'text-emerald-400' :
                        result.status === 'error' ? 'text-red-400' : 'text-slate-500'
                      }`}>
                        {result.status.toUpperCase()}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        {expandedResult === tool.name ? '▲ hide' : '▼ expand'}
                      </span>
                    </div>
                    {expandedResult === tool.name ? (
                      <pre className="text-[10px] text-slate-400 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                        {result.response.slice(0, 2000)}
                      </pre>
                    ) : (
                      <p className="text-[10px] text-slate-600 truncate">{result.response.slice(0, 100)}</p>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Start */}
      <div className="glass rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Connect AI Agents</h2>
        <div className="space-y-3">
          <div className="p-3 bg-white/[0.03] rounded-lg">
            <p className="text-xs font-medium text-emerald-400 mb-2">Claude Desktop</p>
            <pre className="text-[11px] text-slate-400 bg-black/20 rounded-lg p-3 overflow-x-auto">{`{
  "mcpServers": {
    "blinddeal": {
      "command": "npx tsx",
      "args": ["mcp-server/index.ts"]
    }
  }
}`}</pre>
          </div>

          <div className="p-3 bg-white/[0.03] rounded-lg">
            <p className="text-xs font-medium text-sky-400 mb-2">Cursor / Windsurf</p>
            <p className="text-[11px] text-slate-500 mb-2">Add MCP server in Settings → MCP → Point to <code className="text-violet-300">npx tsx mcp-server/index.ts</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}
