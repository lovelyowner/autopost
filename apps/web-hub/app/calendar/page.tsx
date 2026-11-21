"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPlatform } from "@polypost/platform-registry";
import type { ScheduledItem } from "@/lib/config-store";
import {
  addClientScheduledItems,
  deleteClientScheduledItem,
  mergeScheduleWithClient,
} from "@/lib/client-vault";
import {
  formatScheduleToCsv,
  parseScheduleCsv,
  staggerScheduledSlots,
} from "@/lib/schedule-utils";

const QUICK_PLATFORM_SETS = [
  { label: "Social Trio", value: "x, bluesky, mastodon" },
  { label: "Chat Broadcast", value: "discord, fluxer, stoat, telegram" },
  { label: "Video Funnel", value: "youtube, rumble, x, bluesky" },
  { label: "Creator VIP", value: "onlyfans_feed, fansly_wall, manyvids_store, x" },
];

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

  // Quick single-drop scheduler state
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quickTime, setQuickTime] = useState("18:00");
  const [quickPlatforms, setQuickPlatforms] = useState("x, bluesky, discord");

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

  const parsedCsvPreview = useMemo(() => parseScheduleCsv(csvContent), [csvContent]);

  const quickPlatformsList = useMemo(
    () =>
      quickPlatforms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [quickPlatforms],
  );

  const csvNeeds2257 = useMemo(() => {
    const csvAdult = parsedCsvPreview.items.some((item) =>
      item.platforms.some((pid) => getPlatform(pid).requiresAdultTaxonomy),
    );
    const quickAdult = quickPlatformsList.some((pid) => getPlatform(pid).requiresAdultTaxonomy);
    return csvAdult || quickAdult;
  }, [parsedCsvPreview, quickPlatformsList]);

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

  const submitScheduleBatch = async (
    batchItems: Array<Partial<ScheduledItem>>,
    onSuccessClear: () => void,
  ) => {
    const needsAdultGate = batchItems.some((item) =>
      (item.platforms || []).some((pid) => getPlatform(pid).requiresAdultTaxonomy),
    );
    if (needsAdultGate && !confirmed2257) {
      setBanner({
        kind: "err",
        text: "18 U.S.C. 2257 Gate: Check the adult records attestation checkbox before scheduling adult destinations.",
      });
      return;
    }

    const persistBatchLocally = () => {
      const localItems: ScheduledItem[] = batchItems.map((r, idx) => ({
        id: r.id || `sched_${Date.now()}_${idx}`,
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
      onSuccessClear();
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
          items: batchItems,
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
      onSuccessClear();
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

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title || quickPlatformsList.length === 0) {
      setBanner({ kind: "err", text: "Enter a title and at least one comma-separated platform ID." });
      return;
    }
    await submitScheduleBatch(
      [
        {
          title,
          date: quickDate,
          time: `${quickTime} UTC`,
          platforms: quickPlatformsList,
          accountId: accountId || "default",
          mediaPath: mediaPath || undefined,
        },
      ],
      () => setQuickTitle(""),
    );
  };

  const handleBulkCsvImport = async () => {
    if (!csvContent.trim()) {
      setBanner({ kind: "err", text: "Paste CSV lines before importing." });
      return;
    }
    if (parsedCsvPreview.items.length === 0) {
      const firstErr = parsedCsvPreview.skippedLines[0]?.reason;
      setBanner({
        kind: "err",
        text: firstErr || "Invalid CSV format. Expected: Title, YYYY-MM-DD, HH:MM UTC, platform1, platform2...",
      });
      return;
    }
    const batch = parsedCsvPreview.items.map((row) => ({
      ...row,
      accountId: accountId || "default",
      mediaPath: mediaPath || undefined,
    }));
    await submitScheduleBatch(batch, () => setCsvContent(""));
  };

  const handleStaggerQueue = (gapMinutes: number) => {
    if (scheduledPosts.length < 2) {
      setBanner({ kind: "ok", text: "Add at least 2 scheduled posts to auto-stagger slots." });
      return;
    }
    const { items, shiftedCount } = staggerScheduledSlots(scheduledPosts, gapMinutes);
    addClientScheduledItems(items);
    setScheduledPosts(items);
    setBanner({
      kind: "ok",
      text:
        shiftedCount > 0
          ? `Anti-spam stagger applied (+${gapMinutes}m minimum gap): shifted ${shiftedCount} overlapping drop(s).`
          : `All ${items.length} scheduled drop(s) already have at least ${gapMinutes}m spacing.`,
    });
  };

  const handleExportCsv = () => {
    if (scheduledPosts.length === 0) return;
    const csv = formatScheduleToCsv(scheduledPosts);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `polypost-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    <div className="ui-grid-3">
      <div className="md:col-span-2 bg-white space-y-1.5">
        <h1 className="text-xl font-bold text-[#333333]">
          Visual Scheduling Calendar &amp; CSV Bulk Scheduler
        </h1>
        <p className="text-xs text-[#999999]">
          Scheduled campaigns persist to <code className="text-[#333333] font-mono">config/schedule.json</code> and enqueue delayed BullMQ flows into Redis for staggered automated dispatch.
        </p>
        {banner && (
          <div role="status" className="bg-white pt-1 text-xs text-[#333333] flex items-center justify-between gap-3">
            <span>{banner.text}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333]"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="md:col-span-1 bg-white flex flex-col justify-between gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#333333]">Queue Spacing &amp; Export</span>
          <span className="font-mono text-[#999999]">{scheduledPosts.length} Queued</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleStaggerQueue(30)}
            className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333]"
          >
            Auto-Stagger +30m
          </button>
          <button
            type="button"
            onClick={() => handleStaggerQueue(120)}
            className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333]"
          >
            Auto-Stagger +2h
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={scheduledPosts.length === 0}
            className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333] disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Column 2 (1 col): Visual Calendar Agenda with 5px row indent & 1px #cccccc outline */}
      <div className="md:col-span-1 bg-white space-y-2.5">
        <h2 className="text-sm font-bold text-[#333333]">Upcoming Queue Timeline</h2>

        {loading ? (
          <div className="text-xs text-[#999999] py-6 text-center">Loading schedule...</div>
        ) : scheduledPosts.length === 0 ? (
          <div className="text-xs text-[#999999] py-6 text-center">No scheduled campaigns yet.</div>
        ) : (
          <div className="ui-row-list max-h-[600px] overflow-y-auto pr-1">
            {scheduledPosts.map((post) => (
              <div key={post.id} className="bg-white space-y-1.5 text-xs">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h3 className="font-bold text-[#333333] text-xs">{post.title}</h3>
                    <div className="text-[#999999] font-mono text-[10px] mt-0.5">
                      {post.date} at {post.time}
                      {post.queuedJobId && (
                        <span className="ml-1 text-[#333333]">(Job #{post.queuedJobId})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#666666] font-bold text-[10px] uppercase">
                      {post.status}
                    </span>
                    <Link
                      href={`/?scheduledTitle=${encodeURIComponent(post.title)}&scheduledPlatforms=${encodeURIComponent(post.platforms.join(","))}&scheduledMaster=${encodeURIComponent(post.masterPlatformId || post.platforms[0] || "")}&scheduledAccount=${encodeURIComponent(post.accountId || accountId)}&scheduledMedia=${encodeURIComponent(post.mediaPath || "")}`}
                      className="text-[10px] text-[#666666] hover:font-bold hover:text-[#333333]"
                    >
                      Load in Composer
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(post.id)}
                      className="border border-[#cccccc] px-2 py-0.5 rounded bg-white text-[#666666] hover:font-bold hover:text-[#333333] text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {post.platforms.map((pl) => (
                    <span key={pl} className="text-[#999999] font-mono text-[10px]">
                      {pl}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Columns 3-4 (2 cols): Important Quick-Add & CSV Bulk Scheduler */}
      <div className="md:col-span-2 bg-white space-y-4">
          <form
            aria-labelledby="quick-schedule-heading"
            onSubmit={handleQuickAdd}
            className="space-y-3 text-xs"
          >
            <h2 id="quick-schedule-heading" className="text-lg font-bold text-[#333333]">
              Quick-Add Single Drop (UTC)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="quick-title" className="text-[#999999] block mb-1">
                  Campaign Title:
                </label>
                <input
                  id="quick-title"
                  name="title"
                  type="text"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder="Neon Studio Drop #12"
                  className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333]"
                />
              </div>
              <div>
                <label htmlFor="quick-date" className="text-[#999999] block mb-1">
                  Date (UTC):
                </label>
                <input
                  id="quick-date"
                  name="date"
                  type="date"
                  value={quickDate}
                  onChange={(e) => setQuickDate(e.target.value)}
                  className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333] font-mono"
                />
              </div>
              <div>
                <label htmlFor="quick-time" className="text-[#999999] block mb-1">
                  Time (HH:MM UTC):
                </label>
                <input
                  id="quick-time"
                  name="time"
                  type="time"
                  value={quickTime}
                  onChange={(e) => setQuickTime(e.target.value)}
                  className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333] font-mono"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <label htmlFor="quick-platforms" className="text-[#999999] block">
                  Target Platforms (comma-separated):
                </label>
                <input
                  id="quick-platforms"
                  name="platforms"
                  type="text"
                  value={quickPlatforms}
                  onChange={(e) => setQuickPlatforms(e.target.value)}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333] font-mono"
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_PLATFORM_SETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setQuickPlatforms(preset.value)}
                      className="rounded border border-[#cccccc] bg-white px-2 py-0.5 text-[10px] text-[#666666] hover:font-bold hover:text-[#333333]"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="submit"
              className="rounded border border-[#cccccc] bg-white px-4 py-2 text-xs font-bold text-[#333333] hover:font-bold cursor-pointer"
            >
              Add Scheduled Drop
            </button>
          </form>

          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#333333]">CSV Bulk Ingestion</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-[#999999] block mb-1">Vault Account Alias:</label>
                <input
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333] font-mono"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Media File Path or Upload to Stage:</label>
                <input
                  type="text"
                  value={mediaPath}
                  onChange={(e) => setMediaPath(e.target.value)}
                  placeholder="/home/user/Videos/clip.mp4"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333] font-mono"
                />
                <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333] cursor-pointer">
                  <span>{uploadingFile ? "Streaming file to disk..." : "Pick or upload video/image"}</span>
                  <input
                    type="file"
                    accept="video/*,image/*"
                    onChange={handleStageFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <p className="text-xs text-[#999999]">
              Paste CSV lines: <code className="text-[#333333]">Title, YYYY-MM-DD, HH:MM UTC, platform1, platform2...</code>
            </p>

            <textarea
              rows={7}
              placeholder={`Title, Date, Time, Platforms...\nStudio Cyberpunk Shoot, 2026-11-20, 19:00 UTC, youtube, bluesky, fansly_vault\nBehind The Scenes Teaser, 2026-11-21, 21:00 UTC, pornhub_video, x, discord`}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  void handleBulkCsvImport();
                }
              }}
              className="w-full bg-white border-0 border-b border-[#cccccc] p-1 text-xs text-[#333333] font-mono resize-none"
            />

            {csvContent.trim() && (
              <div className="text-[11px] text-[#666666] space-y-1">
                <div>
                  Parsed{" "}
                  <strong className="text-[#333333]">{parsedCsvPreview.items.length}</strong> valid row(s)
                  {parsedCsvPreview.skippedLines.length > 0
                    ? ` · ${parsedCsvPreview.skippedLines.length} skipped line(s)`
                    : ""}
                </div>
                {parsedCsvPreview.skippedLines.slice(0, 3).map((err) => (
                  <div key={err.lineNumber} className="text-[#333333] font-mono text-[10px]">
                    Line {err.lineNumber}: {err.reason}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-white space-y-2 text-xs">
              <label className="flex items-center space-x-2 text-[#666666] cursor-pointer">
                <input
                  type="checkbox"
                  checked={strictLive}
                  onChange={(e) => setStrictLive(e.target.checked)}
                  className="text-[#333333]"
                />
                <span className={strictLive ? "text-[#333333] font-bold" : "text-[#666666]"}>
                  Strict Live Only (fail job if real account session/API key missing — no fake demo links)
                </span>
              </label>

              {csvNeeds2257 && (
                <div className="bg-white space-y-2 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#333333] font-bold">
                    <span>18 U.S.C. 2257 Record-Keeping Gate Required for Adult Targets</span>
                    <input
                      type="text"
                      value={recordsId2257}
                      onChange={(e) => setRecordsId2257(e.target.value)}
                      placeholder="Records Custodian ID"
                      className="bg-white border-0 border-b border-[#cccccc] px-1 py-0.5 font-mono text-[#333333] font-normal"
                    />
                  </div>
                  <label className="flex items-start space-x-2 text-[#333333] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed2257}
                      onChange={(e) => setConfirmed2257(e.target.checked)}
                      className="mt-0.5 text-[#333333]"
                    />
                    <span>
                      I attest that performer age/identity records under <code className="font-mono">{recordsId2257}</code> are verified for all scheduled items.
                    </span>
                  </label>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleBulkCsvImport}
              className="ui-field-btn border-t border-[#cccccc] py-2.5 text-[#333333] font-bold text-xs cursor-pointer"
            >
              Import and Queue CSV Batch
            </button>
          </div>
      </div>
    </div>
  );
}
