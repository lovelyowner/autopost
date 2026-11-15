"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { CampaignHistoryEntry } from "@polypost/node-api-worker";
import { deleteClientHistory, mergeHistoryWithClient } from "@/lib/client-vault";

interface HistorySummary {
  total: number;
  completed: number;
  failed: number;
  liveRuns: number;
  simulatedRuns: number;
}

export default function CampaignHistoryPage() {
  const [history, setHistory] = useState<CampaignHistoryEntry[]>([]);
  const [summary, setSummary] = useState<HistorySummary>({
    total: 0,
    completed: 0,
    failed: 0,
    liveRuns: 0,
    simulatedRuns: 0,
  });
  const [loading, setLoading] = useState(true);
  const [previewScreenshot, setPreviewScreenshot] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "failed" | "live" | "simulated">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const computeSummary = (entries: CampaignHistoryEntry[]): HistorySummary => {
    let completed = 0;
    let failed = 0;
    let simulatedRuns = 0;
    let liveRuns = 0;
    for (const item of entries) {
      if (item.step === "completed") completed++;
      if (item.step === "failed") failed++;
      if (item.masterSimulated === true) simulatedRuns++;
      else liveRuns++;
    }
    return {
      total: entries.length,
      completed,
      failed,
      liveRuns,
      simulatedRuns,
    };
  };

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns/history");
      if (res.ok) {
        const data = await res.json();
        const merged = mergeHistoryWithClient(data.history || []);
        setHistory(merged);
        setSummary(computeSummary(merged));
      } else {
        const localOnly = mergeHistoryWithClient([]);
        setHistory(localOnly);
        setSummary(computeSummary(localOnly));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleDelete = async (campaignId?: string) => {
    deleteClientHistory(campaignId, false);
    const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    try {
      await fetch(`/api/campaigns/history${query}`, { method: "DELETE" });
    } catch {
      // Ignore server errors in stateless cloud mode
    }
    setBanner(campaignId ? `Removed '${campaignId}' from history.` : "Cleared campaign history.");
    await loadHistory();
  };

  const handleDeleteSimulated = async () => {
    deleteClientHistory(undefined, true);
    const res = await fetch("/api/campaigns/history?mode=simulated", { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      setBanner(
        `Pruned simulated demo run(s); preserved live campaign records (server deleted ${data.deleted ?? 0}).`,
      );
    } else {
      setBanner("Pruned simulated demo runs from browser history.");
    }
    await loadHistory();
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify({ summary, history }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `polypost-campaign-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const rows: string[][] = [
      [
        "campaignId",
        "updatedAt",
        "topic",
        "step",
        "masterPlatformId",
        "masterAccountId",
        "liveMasterUrl",
        "teaserPlatformId",
        "teaserAccountId",
        "teaserStatus",
        "teaserPublishedUrl",
      ],
    ];
    for (const item of history) {
      const iso = new Date(item.updatedAt).toISOString();
      if (!item.teasers || item.teasers.length === 0) {
        rows.push([
          item.campaignId,
          iso,
          item.topic || "",
          item.step,
          item.masterPlatformId || "",
          item.accountId || "",
          item.liveMasterUrl || "",
          "",
          "",
          "",
          "",
        ]);
      } else {
        for (const t of item.teasers) {
          rows.push([
            item.campaignId,
            iso,
            item.topic || "",
            item.step,
            item.masterPlatformId || "",
            item.accountId || "",
            item.liveMasterUrl || "",
            t.platformId || "",
            (t as any).accountId || item.accountId || "",
            t.status || "",
            t.publishedUrl || "",
          ]);
        }
      }
    }
    const csvText = rows
      .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `polypost-campaign-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="bg-white border border-[#cccccc] rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#333333] mb-1">Campaign Telemetry &amp; History Log</h1>
          <p className="text-sm text-[#999999]">
            Persisted to <code className="font-mono text-[#333333]">data/campaign-history.json</code> beyond Redis TTL, including live vs demo execution tags and failure DOM screenshots.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={history.length === 0}
            className="px-3 py-1.5 rounded bg-white hover:bg-white text-xs text-[#333333] border border-[#cccccc] font-medium cursor-pointer disabled:opacity-40"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJson}
            disabled={history.length === 0}
            className="px-3 py-1.5 rounded bg-white hover:bg-white text-xs text-[#333333] border border-[#cccccc] font-medium cursor-pointer disabled:opacity-40"
          >
            Export JSON
          </button>
          <button
            onClick={() => void loadHistory()}
            className="border border-[#cccccc] px-3 py-1.5 rounded bg-white hover:bg-white text-xs text-[#333333] font-medium cursor-pointer"
          >
            Refresh
          </button>
          {summary.simulatedRuns > 0 && (
            <button
              onClick={() => void handleDeleteSimulated()}
              className="px-3 py-1.5 rounded bg-white hover:bg-white text-xs text-[#333333] border border-[#cccccc] font-medium cursor-pointer"
            >
              Clear Simulated Only ({summary.simulatedRuns})
            </button>
          )}
          <button
            onClick={() => void handleDelete()}
            disabled={history.length === 0}
            className="px-3 py-1.5 rounded bg-white hover:bg-white text-xs text-[#333333] border border-[#cccccc] font-medium cursor-pointer disabled:opacity-40"
          >
            Clear All
          </button>
        </div>
      </div>

      {banner && (
        <div className="p-3 rounded-lg bg-white border border-[#cccccc] text-xs text-[#333333] flex items-center justify-between">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-[11px] opacity-75 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-[#cccccc] rounded-xl p-4">
          <span className="text-[#999999] block">Total Runs</span>
          <span className="text-2xl font-bold text-[#333333] font-mono">{summary.total}</span>
        </div>
        <div className="bg-white border border-[#cccccc] rounded-xl p-4">
          <span className="text-[#999999] block">Completed</span>
          <span className="text-2xl font-bold text-[#333333] font-mono">{summary.completed}</span>
        </div>
        <div className="bg-white border border-[#cccccc] rounded-xl p-4">
          <span className="text-[#999999] block">Failed / DLQ</span>
          <span className="text-2xl font-bold text-[#333333] font-mono">{summary.failed}</span>
        </div>
        <div className="bg-white border border-[#cccccc] rounded-xl p-4">
          <span className="text-[#999999] block">Live Dispatches</span>
          <span className="text-2xl font-bold text-[#333333] font-mono">{summary.liveRuns}</span>
        </div>
        <div className="bg-white border border-[#cccccc] rounded-xl p-4">
          <span className="text-[#999999] block">Demo / Simulated</span>
          <span className="text-2xl font-bold text-[#333333] font-mono">{summary.simulatedRuns}</span>
        </div>
      </div>

      {previewScreenshot && (
        <div className="border border-[#cccccc] fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/95">
          <div className="bg-white border border-[#cccccc] rounded-xl max-w-3xl w-full p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-[#333333]">Failure Screenshot: {previewScreenshot}</span>
              <button
                onClick={() => setPreviewScreenshot(null)}
                className="border border-[#cccccc] px-2.5 py-1 rounded bg-white text-[#333333] hover:bg-white"
              >
                Close
              </button>
            </div>
            <img
              src={`/api/campaigns/failures/${encodeURIComponent(previewScreenshot)}`}
              alt={`Failure screenshot ${previewScreenshot}`}
              className="w-full max-h-[75vh] object-contain rounded border border-[#cccccc] bg-white"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-xs text-[#999999]">Loading campaign history...</div>
      ) : history.length === 0 ? (
        <div className="bg-white border border-[#cccccc] rounded-xl p-8 text-center text-xs text-[#999999] space-y-2">
          <p className="text-[#333333] font-medium">No campaigns recorded yet.</p>
          <p>Launch a campaign from the Composer to inspect live telemetry, generated links, and failure diagnostics here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search & Status Filter Bar */}
          <div className="bg-white border border-[#cccccc] rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all", label: `All (${history.length})` },
                  { id: "completed", label: "Completed" },
                  { id: "failed", label: "Failed / Has Errors" },
                  { id: "live", label: "Live Only" },
                  { id: "simulated", label: "Simulated" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 rounded font-medium cursor-pointer transition-colors ${ statusFilter === tab.id ? "border border-[#cccccc] bg-white text-[#333333]" : "bg-white border border-[#cccccc] text-[#999999] hover:text-[#333333]" }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-1 md:max-w-sm">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by topic, platform (x, reddit, manyvids), account alias, or ID..."
                className="w-full bg-white border border-[#cccccc] rounded px-2.5 py-1.5 text-xs text-[#333333] placeholder-[#999999]"
              />
              {(searchQuery || statusFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                  className="border border-[#cccccc] px-2 py-1 rounded bg-white hover:bg-white text-[#666666] text-[11px] cursor-pointer whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {history
            .filter((item) => {
              if (statusFilter === "completed" && item.step !== "completed") return false;
              if (
                statusFilter === "failed" &&
                item.step !== "failed" &&
                !item.teasers.some((t) => t.status === "failed")
              ) {
                return false;
              }
              if (statusFilter === "live" && item.masterSimulated !== false) return false;
              if (statusFilter === "simulated" && item.masterSimulated !== true) return false;

              const q = searchQuery.trim().toLowerCase();
              if (!q) return true;
              const hay = [
                item.campaignId,
                item.topic,
                item.masterPlatformId,
                item.accountId,
                item.liveMasterUrl,
                ...item.teasers.flatMap((t) => [t.platformId, t.accountId, t.publishedUrl, t.error]),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return hay.includes(q);
            })
            .map((item) => (
            <div key={item.campaignId} className="bg-white border border-[#cccccc] rounded-xl p-5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cccccc] pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-[#333333]">{item.topic}</span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${ item.step === "completed" ? "bg-white text-[#333333] border border-[#cccccc]" : item.step === "failed" ? "bg-white text-[#333333] border border-[#cccccc]" : "bg-white text-[#333333] border border-[#cccccc]" }`}
                    >
                      {item.step}
                    </span>
                    {item.masterSimulated !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${ item.masterSimulated ? "border border-[#cccccc] bg-white text-[#333333]" : "border border-[#cccccc] bg-white text-[#333333]" }`}
                      >
                        {item.masterSimulated ? "SIMULATED" : "LIVE"}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-[#999999]">
                    ID: {item.campaignId} · Master: {item.masterPlatformId} · Account: {item.accountId} ·{" "}
                    {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  {(item.liveMasterUrl || item.teasers.some((t) => Boolean(t.publishedUrl))) && (
                    <button
                      onClick={() => {
                        const urls = [
                          item.liveMasterUrl,
                          ...item.teasers.map((t) => t.publishedUrl),
                        ]
                          .filter(Boolean)
                          .join("\n");
                        if (urls) {
                          void navigator.clipboard.writeText(urls);
                          setBanner(`Copied ${urls.split("\n").length} published URL(s) from ${item.campaignId} to clipboard.`);
                        }
                      }}
                      className="px-2.5 py-1 rounded bg-white hover:bg-white border border-[#cccccc] text-[#333333] font-medium cursor-pointer"
                    >
                      Copy All URLs
                    </button>
                  )}
                  {item.teasers.some((t) => t.status === "failed") && (
                    <Link
                      href={`/?rerun=${encodeURIComponent(item.campaignId)}&failedOnly=1`}
                      className="border border-[#cccccc] px-3 py-1 rounded bg-white hover:bg-white text-[#333333] font-medium"
                    >
                      Retry Failed Only
                    </Link>
                  )}
                  <Link
                    href={`/?rerun=${encodeURIComponent(item.campaignId)}`}
                    className="border border-[#cccccc] px-3 py-1 rounded bg-white hover:bg-white text-[#333333] font-medium"
                  >
                    Load in Composer
                  </Link>
                  <button
                    onClick={() => void handleDelete(item.campaignId)}
                    className="border border-[#cccccc] px-2.5 py-1 rounded bg-white hover:bg-white text-[#666666] hover:text-[#333333] cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {item.liveMasterUrl && (
                <div className="p-2 rounded bg-white border border-[#cccccc] font-mono text-[11px] break-all">
                  <span className="text-[#333333]">Master URL: </span>
                  <a href={item.liveMasterUrl} target="_blank" rel="noreferrer" className="text-[#333333] underline">
                    {item.liveMasterUrl}
                  </a>
                </div>
              )}

              {item.masterError && (
                <div className="p-2 rounded bg-white border border-[#cccccc] font-mono text-[11px] text-[#333333]">
                  Master Error: {item.masterError}
                </div>
              )}

              {item.teasers.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {item.teasers.map((t) => (
                    <div
                      key={t.jobId}
                      className="p-2.5 rounded bg-white border border-[#cccccc] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-[#333333]">{t.platformName || t.platformId}</span>
                          <span
                            className={`text-[10px] font-mono ${ t.status === "published" ? "text-[#333333]" : t.status === "failed" ? "text-[#333333]" : "text-[#999999]" }`}
                          >
                            {t.status}
                          </span>
                        </div>
                        <p className="font-mono text-[10px] text-[#999999] truncate">
                          {t.error
                            ? t.error.split("\n")[0].slice(0, 110)
                            : t.publishedUrl || t.injectedCaption}
                        </p>
                        {t.error && t.error.length > 110 && (
                          <details className="text-[10px] text-[#666666] font-mono mt-0.5">
                            <summary className="cursor-pointer hover:text-[#333333]">Show full error trace</summary>
                            <pre className="whitespace-pre-wrap break-all mt-1 p-1.5 rounded bg-white border border-[#cccccc]">
                              {t.error}
                            </pre>
                          </details>
                        )}
                      </div>
                      {t.failureScreenshot && (
                        <button
                          onClick={() => setPreviewScreenshot(t.failureScreenshot!)}
                          className="border border-[#cccccc] px-2 py-1 rounded bg-white hover:bg-white text-[#333333] text-[10px] whitespace-nowrap cursor-pointer"
                        >
                          View Error PNG
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
