"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getPlatform } from "@polypost/platform-registry";
import type { ScheduledItem } from "@/lib/config-store";
import {
  addClientScheduledItems,
  deleteClientScheduledItem,
  mergeScheduleWithClient,
} from "@/lib/client-vault";

export default function CalendarPage() {
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [csvContent, setCsvContent] = useState("");
  const [accountId, setAccountId] = useState("main_creator");
  const [mediaPath, setMediaPath] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [confirmed2257, setConfirmed2257] = useState(false);
  const [recordsId2257, setRecordsId2257] = useState("REC-2257-VAULT-NOVA-2026");
  const [strictLive, setStrictLive] = useState(false);
  const [cloudMode, setCloudMode] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then((data) => setScheduledPosts(mergeScheduleWithClient(data.items || [])))
      .catch((err) => {
        setScheduledPosts(mergeScheduleWithClient([]));
        setBanner({ kind: "err", text: `Server schedule unavailable (${err.message}); showing browser schedule.` });
      })
      .finally(() => setLoading(false));
    fetch("/api/credentials/status")
      .then((r) => r.json())
      .then((data) => {
        if (data?.cloudMode) setCloudMode(true);
        if (data?.services?.simulationDisabled) setStrictLive(true);
      })
      .catch(() => {});
  }, []);

  const csvNeeds2257 = useMemo(() => {
    const lines = csvContent.trim().split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.toLowerCase().startsWith("title")) continue;
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length >= 4 && parts.slice(3).some((pid) => getPlatform(pid).requiresAdultTaxonomy)) {
        return true;
      }
    }
    return false;
  }, [csvContent]);

  const handleStageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (cloudMode && file.size > 4 * 1024 * 1024) {
      setMediaPath(file.name);
      setBanner({
        kind: "ok",
        text: `Selected '${file.name}' (${(file.size / (1024 * 1024)).toFixed(2)} MB). Note: Vercel serverless skips >4MB binary upload; connect your Companion Worker or use local stack for large video execution.`,
      });
      return;
    }
    setUploadingFile(true);
    try {
      const res = await fetch(`/api/media/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Upload failed");
      setMediaPath(data.filePath);
      setBanner({ kind: "ok", text: `Staged '${data.originalName}' (${data.sizeMb} MB) at ${data.filePath}` });
    } catch (err: any) {
      setBanner({ kind: "err", text: `File staging failed: ${err.message}` });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleBulkCsvImport = async () => {
    if (!csvContent.trim()) {
      setBanner({ kind: "err", text: "Paste CSV lines before importing." });
      return;
    }

    const lines = csvContent.trim().split("\n");
    const parsedItems: Array<Partial<ScheduledItem>> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#") || line.toLowerCase().startsWith("title")) continue;
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length >= 4) {
        parsedItems.push({
          title: parts[0],
          date: parts[1],
          time: parts[2],
          platforms: parts.slice(3),
          accountId: accountId || "default",
          mediaPath: mediaPath || undefined,
        });
      }
    }

    if (parsedItems.length === 0) {
      setBanner({
        kind: "err",
        text: "Invalid CSV format. Expected: Title, Date (YYYY-MM-DD), Time, Platform1, Platform2...",
      });
      return;
    }

    if (csvNeeds2257 && !confirmed2257) {
      setBanner({
        kind: "err",
        text: "18 U.S.C. 2257 Gate: Check the adult records attestation checkbox before scheduling adult destinations.",
      });
      return;
    }

    const persistBatchLocally = () => {
      const localItems: ScheduledItem[] = parsedItems.map((r, idx) => ({
        id: `sched_${Date.now()}_${idx}`,
        title: String(r.title),
        date: String(r.date || new Date().toISOString().slice(0, 10)),
        time: String(r.time || "12:00 UTC"),
        platforms: r.platforms || [],
        masterPlatformId: r.platforms?.[0] || "bluesky",
        mediaPath: r.mediaPath,
        accountId: r.accountId,
        status: "scheduled",
        createdAt: Date.now(),
      }));
      addClientScheduledItems(localItems);
      setScheduledPosts((prev) => mergeScheduleWithClient(prev));
      setCsvContent("");
      setBanner({
        kind: "ok",
        text: `Saved ${localItems.length} scheduled item(s) cleanly in your browser schedule (localStorage).`,
      });
    };

    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: parsedItems,
          enqueueInRedis: true,
          confirmed2257Attestation: confirmed2257,
          recordsId2257,
          strictLive,
        }),
      });
      const data = await res.json();
      if (res.status === 428) {
        throw new Error(data.message || data.error || "2257 attestation required");
      }
      if (!res.ok) {
        persistBatchLocally();
        return;
      }
      if (cloudMode && Array.isArray(data.items)) {
        addClientScheduledItems(data.items);
      }
      setScheduledPosts(mergeScheduleWithClient(data.items || []));
      setCsvContent("");
      setBanner({
        kind: "ok",
        text: cloudMode
          ? `Saved ${data.addedCount} scheduled item(s) to your browser schedule.`
          : `Persisted & scheduled ${data.addedCount} campaign(s) to config/schedule.json (delayed BullMQ flows registered where Redis active).`,
      });
      setTimeout(() => setBanner(null), 5000);
    } catch (err: any) {
      if (err.message?.includes("2257")) {
        setBanner({ kind: "err", text: err.message });
      } else {
        persistBatchLocally();
      }
    }
  };

  const handleDelete = async (id: string) => {
    deleteClientScheduledItem(id);
    try {
      const res = await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setScheduledPosts(mergeScheduleWithClient(data.items || []));
      } else {
        setScheduledPosts((prev) => prev.filter((item) => item.id !== id));
      }
      setBanner({ kind: "ok", text: "Removed scheduled campaign." });
    } catch {
      setScheduledPosts((prev) => prev.filter((item) => item.id !== id));
      setBanner({ kind: "ok", text: "Removed scheduled campaign." });
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h1 className="text-2xl font-bold text-white mb-2">
          Visual Scheduling Calendar & CSV Bulk Scheduler
        </h1>
        <p className="text-sm text-slate-400">
          Scheduled campaigns persist to <code className="text-indigo-300 font-mono">config/schedule.json</code> and enqueue delayed BullMQ flows into Redis for staggered automated dispatch.
        </p>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            banner.kind === "ok"
              ? "bg-emerald-950/70 border-emerald-700 text-emerald-200"
              : "bg-red-950/70 border-red-700 text-red-200"
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-[11px] opacity-75 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Visual Calendar Agenda */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Upcoming Queue Timeline</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-mono">
              {scheduledPosts.length} Queued
            </span>
          </div>

          {loading ? (
            <div className="text-xs text-slate-400 py-6 text-center">Loading schedule...</div>
          ) : scheduledPosts.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">No scheduled campaigns yet.</div>
          ) : (
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {scheduledPosts.map((post) => (
                <div
                  key={post.id}
                  className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="font-bold text-white text-sm">{post.title}</h3>
                      <div className="text-slate-400 font-mono text-[11px] mt-0.5">
                        {post.date} at {post.time}
                        {post.queuedJobId && (
                          <span className="ml-2 text-indigo-400">(Redis Job #{post.queuedJobId})</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-medium text-[10px] uppercase">
                        {post.status}
                      </span>
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="px-2 py-0.5 rounded bg-slate-900 hover:bg-red-950 text-red-400 text-[10px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-1">
                    {post.platforms.map((pl) => (
                      <span
                        key={pl}
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[10px]"
                      >
                        {pl}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CSV Bulk Scheduler */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">CSV Bulk Ingestion</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Vault Account Alias:</label>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Media File Path or Upload to Stage:</label>
              <input
                type="text"
                value={mediaPath}
                onChange={(e) => setMediaPath(e.target.value)}
                placeholder="/home/user/Videos/clip.mp4"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
              />
              <label className="mt-1.5 inline-flex items-center gap-2 text-[11px] text-indigo-300 hover:text-indigo-200 cursor-pointer">
                <span>{uploadingFile ? "Streaming file to disk..." : "Or pick/upload video or image from computer ->"}</span>
                <input
                  type="file"
                  accept="video/*,image/*"
                  onChange={handleStageFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Paste CSV lines: <code className="text-indigo-300">Title, YYYY-MM-DD, HH:MM UTC, platform1, platform2...</code>
          </p>

          <textarea
            rows={8}
            placeholder={`Title, Date, Time, Platforms...\nStudio Cyberpunk Shoot, 2026-11-20, 19:00 UTC, youtube, bluesky, fansly_vault\nBehind The Scenes Teaser, 2026-11-21, 21:00 UTC, pornhub_video, x, discord`}
            value={csvContent}
            onChange={(e) => setCsvContent(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 font-mono resize-none"
          />

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
            <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={strictLive}
                onChange={(e) => setStrictLive(e.target.checked)}
                className="rounded border-slate-700 text-emerald-600"
              />
              <span className={strictLive ? "text-emerald-300 font-semibold" : ""}>
                Strict Live Only (fail job if real account session/API key missing — no fake demo links)
              </span>
            </label>

            {csvNeeds2257 && (
              <div className="p-2.5 rounded bg-amber-950/50 border border-amber-700/70 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-300 font-bold">
                  <span>18 U.S.C. 2257 Record-Keeping Gate Required for Adult CSV Targets</span>
                  <input
                    type="text"
                    value={recordsId2257}
                    onChange={(e) => setRecordsId2257(e.target.value)}
                    placeholder="Records Custodian ID"
                    className="bg-slate-950 border border-amber-800 rounded px-2 py-0.5 font-mono text-amber-200 font-normal"
                  />
                </div>
                <label className="flex items-start space-x-2 text-amber-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed2257}
                    onChange={(e) => setConfirmed2257(e.target.checked)}
                    className="mt-0.5 rounded border-amber-600 text-amber-500"
                  />
                  <span>
                    I attest that performer age/identity records under <code className="font-mono">{recordsId2257}</code> are verified for all scheduled items.
                  </span>
                </label>
              </div>
            )}
          </div>

          <button
            onClick={handleBulkCsvImport}
            className="w-full py-2.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            Import and Queue CSV Batch
          </button>
        </div>
      </div>
    </div>
  );
}
