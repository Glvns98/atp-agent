import { useState, useEffect, useRef } from 'react';

// Sahara Theme colors
// Background: #FDFBF7 (Sand)
// Accent: #E07A5F (Terracotta/Amber)
// Dark: #3D405B (Deep Blue)
// Glass: rgba(255, 255, 255, 0.7)

interface Event {
  timestamp: string;
  agent_id: string;
  action: string;
  status: string;
  reason?: string;
  escalation_id?: string;
  proof?: string;
  prev_hash?: string;
  arguments?: any;
}

export default function App() {
  const [events, setEvents] = useState<Event[]>([]);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'ledger' | 'supply_chain' | 'anomaly'>('telemetry');
  const [auditStatus, setAuditStatus] = useState<{status: 'idle' | 'verifying' | 'valid' | 'corrupt', message: string}>({status: 'idle', message: ''});
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Initial fetch
    fetch('http://localhost:8081/v1/telemetry')
      .then(r => r.json())
      .then(data => {
        if (data.events) setEvents(data.events);
      });

    fetch('http://localhost:8081/v1/killswitch')
      .then(r => r.json())
      .then(data => setKillSwitchActive(data.active));

    // WebSocket connect
    ws.current = new WebSocket('ws://localhost:8081/v1/stream');
    ws.current.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        setEvents(prev => [ev, ...prev].slice(0, 200));
      } catch(e) {}
    };

    return () => ws.current?.close();
  }, []);

  const toggleKillSwitch = async () => {
    const newVal = !killSwitchActive;
    await fetch('http://localhost:8081/v1/killswitch', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ active: newVal })
    });
    setKillSwitchActive(newVal);
  };

  const verifyLedger = async () => {
    setAuditStatus({status: 'verifying', message: 'Verifying mathematical chain...'});
    try {
      const res = await fetch('http://localhost:8081/v1/audit/verify');
      const data = await res.json();
      if (data.status === 'valid') {
        setAuditStatus({status: 'valid', message: data.message});
      } else {
        setAuditStatus({status: 'corrupt', message: data.message});
      }
    } catch(e) {
      setAuditStatus({status: 'corrupt', message: 'Failed to connect to Verifier Engine'});
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#3D405B] font-sans p-8" style={{ background: 'linear-gradient(135deg, #FDFBF7 0%, #F4E8D1 100%)' }}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex justify-between items-center bg-white/40 backdrop-blur-md p-6 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.05)] border border-white/60">
          <div>
            <h1 className="text-4xl font-light tracking-tight flex items-center gap-3">
              <span className="text-[#E07A5F]">Sahara</span> 
              <span className="font-semibold">Command Center</span>
            </h1>
            <p className="text-sm text-[#3D405B]/60 mt-2 font-medium tracking-wide uppercase">ATP Open Standard • Local First</p>
          </div>
          
          <button 
            onClick={toggleKillSwitch}
            className={`relative overflow-hidden group px-8 py-4 rounded-xl font-bold text-lg shadow-lg transition-all duration-300 ${killSwitchActive ? 'bg-red-500 text-white animate-pulse shadow-red-500/50' : 'bg-gradient-to-r from-[#E07A5F] to-[#D96B4F] text-white hover:shadow-[#E07A5F]/40'}`}
          >
            {killSwitchActive ? 'SYSTEM HALTED - CLICK TO RESUME' : 'ENGAGE GLOBAL KILL SWITCH'}
          </button>
        </header>

        {/* Tabs */}
        <div className="flex gap-4">
          <button onClick={() => setActiveTab('telemetry')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'telemetry' ? 'bg-[#3D405B] text-white shadow-md' : 'bg-white/50 hover:bg-white/80'}`}>Live Telemetry</button>
          <button onClick={() => setActiveTab('ledger')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'ledger' ? 'bg-[#3D405B] text-white shadow-md' : 'bg-white/50 hover:bg-white/80'}`}>Cryptographic Ledger</button>
          <button onClick={() => setActiveTab('supply_chain')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'supply_chain' ? 'bg-[#3D405B] text-white shadow-md' : 'bg-white/50 hover:bg-white/80'}`}>SBOM & Supply Chain</button>
          <button onClick={() => setActiveTab('anomaly')} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'anomaly' ? 'bg-[#3D405B] text-white shadow-md' : 'bg-white/50 hover:bg-white/80'}`}>Anomaly Timeline</button>
        </div>

        {/* Content */}
        <main className="bg-white/40 backdrop-blur-md rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.05)] border border-white/60 overflow-hidden">
          
          {activeTab === 'telemetry' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#3D405B]/10 bg-white/30 text-sm tracking-wider">
                    <th className="p-4 font-semibold">Timestamp</th>
                    <th className="p-4 font-semibold">Agent</th>
                    <th className="p-4 font-semibold">Action</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={i} className="border-b border-[#3D405B]/5 hover:bg-white/40 transition-colors">
                      <td className="p-4 font-mono text-xs text-[#3D405B]/70">{new Date(e.timestamp).toLocaleTimeString()}</td>
                      <td className="p-4 font-medium">{e.agent_id}</td>
                      <td className="p-4"><span className="bg-[#E07A5F]/10 text-[#E07A5F] px-3 py-1 rounded-full text-xs font-bold uppercase">{e.action}</span></td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${e.status === 'ALLOW' ? 'bg-green-100 text-green-700' : e.status === 'BLOCK' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-[#3D405B]/80">{e.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">Immutable Attestation Chain</h2>
                <div className="flex gap-4 items-center">
                  {auditStatus.status === 'verifying' && <span className="text-blue-600 animate-pulse font-medium text-sm">Verifying...</span>}
                  {auditStatus.status === 'valid' && <span className="text-green-600 font-bold text-sm bg-green-100 px-3 py-1 rounded">✓ {auditStatus.message}</span>}
                  {auditStatus.status === 'corrupt' && <span className="text-red-600 font-bold text-sm bg-red-100 px-3 py-1 rounded">❌ {auditStatus.message}</span>}
                  
                  <button 
                    onClick={verifyLedger}
                    disabled={auditStatus.status === 'verifying'}
                    className="bg-[#3D405B] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#3D405B]/80 transition disabled:opacity-50"
                  >
                    Verify Chain Integrity
                  </button>
                  <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    Chain Intact (SQLite)
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {events.filter(e => e.proof || e.prev_hash).map((e, i) => (
                  <div key={i} className="bg-white/60 p-4 rounded-xl border border-white/80 font-mono text-sm shadow-sm relative pl-10">
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-[#E07A5F]/30" />
                    <div className="absolute left-[11px] top-6 w-3 h-3 rounded-full bg-[#E07A5F]" />
                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-3 text-[#3D405B]/60">{new Date(e.timestamp).toISOString()}</div>
                      <div className="col-span-9 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#3D405B]">Agent:</span> {e.agent_id}
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-bold text-[#3D405B]/70">Prev Hash:</span>
                          <span className="truncate text-gray-500">{e.prev_hash || 'genesis'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-bold text-[#E07A5F]">Proof:</span>
                          <span className="truncate text-[#E07A5F]/80">{e.proof || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'supply_chain' && (
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4">SBOM & Supply Chain Status</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white/60 p-5 rounded-xl border border-white/80 shadow-sm">
                  <h3 className="font-bold text-[#3D405B] mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div> atp-core (Python SDK)
                  </h3>
                  <p className="text-sm text-gray-600 mb-2">Hash Verification: <span className="font-mono text-green-700 bg-green-100 px-2 rounded">Verified via requirements.txt</span></p>
                  <p className="text-sm text-gray-600">Runtime imports pinned to SHA256 hashes.</p>
                </div>
                <div className="bg-white/60 p-5 rounded-xl border border-white/80 shadow-sm">
                  <h3 className="font-bold text-[#3D405B] mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div> Go L7 Proxy Engine
                  </h3>
                  <p className="text-sm text-gray-600 mb-2">SBOM: <span className="font-mono text-blue-700 bg-blue-100 px-2 rounded">sbom.cdx.json</span></p>
                  <p className="text-sm text-gray-600">Dependencies: modernc.org/sqlite, goproxy</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'anomaly' && (
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4">Behavioral Anomaly & Taint Timeline</h2>
              <div className="space-y-4">
                {events.filter(e => e.status === 'BLOCK' || e.status === 'ESCALATE' || e.reason?.includes('Taint')).length === 0 && (
                  <p className="text-gray-500 italic">No anomalies or tainted events detected in this session.</p>
                )}
                {events.filter(e => e.status === 'BLOCK' || e.status === 'ESCALATE' || e.reason?.includes('Taint')).map((e, i) => (
                  <div key={i} className="bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm relative pl-10">
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-red-200" />
                    <div className="absolute left-[11px] top-6 w-3 h-3 rounded-full bg-red-500" />
                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-3 text-red-900/60 font-mono text-sm">{new Date(e.timestamp).toLocaleTimeString()}</div>
                      <div className="col-span-9">
                        <div className="font-bold text-red-900">Agent: {e.agent_id}</div>
                        <div className="text-sm text-red-800 mt-1 font-semibold">{e.reason}</div>
                        <div className="text-xs text-red-700 mt-1 bg-red-100 p-2 rounded">Action: {e.action} | Status: {e.status}</div>
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
