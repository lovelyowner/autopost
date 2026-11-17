"use client";

import React, { useEffect, useState } from "react";
import type { PresetProfile } from "@/lib/config-store";
import {
  deleteClientPreset,
  mergePresetsWithClient,
  saveClientPreset,
} from "@/lib/client-vault";

export default function PresetsPage() {
  const [presets, setPresets] = useState<PresetProfile[]>([]);
  const [activePreset, setActivePreset] = useState<PresetProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusBanner, setStatusBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((data) => {
        const list = mergePresetsWithClient(data.presets || []);
        setPresets(list);
        if (list.length > 0) setActivePreset(list[0]);
      })
      .catch((err) => setStatusBanner({ kind: "err", text: `Failed to load presets: ${err.message}` }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!activePreset) return;
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activePreset),
      });
      if (res.ok) {
        const data = await res.json();
        const merged = mergePresetsWithClient(data.presets || presets);
        setPresets(merged);
        setStatusBanner({
          kind: "ok",
          text: `Saved '${activePreset.name}' cleanly. Select it directly in the Composer.`,
        });
      } else {
        saveClientPreset(activePreset);
        const merged = mergePresetsWithClient(presets);
        setPresets(merged);
        setStatusBanner({
          kind: "ok",
          text: `Saved '${activePreset.name}' in your browser vault (localStorage) — active immediately in Composer!`,
        });
      }
      setTimeout(() => setStatusBanner(null), 4000);
    } catch {
      saveClientPreset(activePreset);
      setPresets((prev) => mergePresetsWithClient(prev));
      setStatusBanner({
        kind: "ok",
        text: `Saved '${activePreset.name}' in your browser vault (localStorage).`,
      });
    }
  };

  const handleDelete = async (id: string) => {
    deleteClientPreset(id);
    try {
      const res = await fetch(`/api/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        const merged = mergePresetsWithClient(data.presets || []);
        setPresets(merged);
        setActivePreset(merged[0] || null);
      } else {
        const next = presets.filter((p) => p.id !== id);
        setPresets(next);
        setActivePreset(next[0] || null);
      }
      setStatusBanner({ kind: "ok", text: "Preset removed." });
    } catch {
      const next = presets.filter((p) => p.id !== id);
      setPresets(next);
      setActivePreset(next[0] || null);
      setStatusBanner({ kind: "ok", text: "Preset removed from browser vault." });
    }
  };

  const handleTagChange = (index: number, value: string) => {
    if (!activePreset) return;
    const updated = [...activePreset.seoTags];
    updated[index] = value;
    setActivePreset({ ...activePreset, seoTags: updated });
  };

  return (
    <div className="space-y-8 bg-white">
      <div className="bg-white space-y-2">
        <h1 className="text-2xl font-bold text-[#333333]">
          Templates, Pricing &amp; Compliance Preset Manager
        </h1>
        <p className="text-sm text-[#999999]">
          Presets are saved to disk (<code className="text-[#333333] font-mono">config/presets.json</code>) and automatically load inside the Unified Composer so custodian IDs, watermarks, PPV prices, and SEO tags never go out of sync.
        </p>
      </div>

      {statusBanner && (
        <div className="bg-white text-xs text-[#333333] flex items-center justify-between gap-3">
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333]"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-[#999999]">Loading persisted presets...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Preset Selector */}
          <div className="md:col-span-1 space-y-4">
            <div className="bg-white space-y-3">
              <h2 className="text-sm font-bold text-[#333333] uppercase tracking-wider">Saved Presets</h2>
              <div className="space-y-2">
                {presets.map((p) => {
                  const selected = activePreset?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className="bg-white flex items-start justify-between gap-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setActivePreset(p)}
                        className={`rounded border border-[#cccccc] bg-white px-3 py-2 text-left flex-1 ${
                          selected
                            ? "font-bold text-[#333333]"
                            : "text-[#666666] hover:font-bold hover:text-[#333333]"
                        }`}
                      >
                        <div className={selected ? "font-bold text-[#333333]" : "text-[#333333]"}>{p.name}</div>
                        <div className="font-mono text-[10px] text-[#999999] mt-0.5 font-normal">{p.recordsId2257}</div>
                      </button>
                      {presets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          className="rounded border border-[#cccccc] text-[10px] text-[#666666] hover:font-bold hover:text-[#333333] px-2 py-1 bg-white"
                          title="Delete preset"
                        >
                          Del
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  const newP: PresetProfile = {
                    id: `preset_${Date.now()}`,
                    name: "New Custom Preset",
                    recordsId2257: "REC-2257-NEW",
                    custodianContact: "custodian@example.com",
                    ppvPriceUsd: 19.99,
                    watermarkPngPath: "/watermarks/logo.png",
                    watermarkPosition: "bottom-right",
                    seoTags: Array(16).fill("").map((_, i) => `tag${i + 1}`),
                  };
                  setPresets([...presets, newP]);
                  setActivePreset(newP);
                }}
                className="border border-[#cccccc] w-full py-2 rounded bg-white text-[#333333] text-xs font-bold"
              >
                + Create New Preset
              </button>
            </div>
          </div>

          {/* Preset Editor */}
          {activePreset && (
            <div className="md:col-span-2 space-y-6">
              <div className="bg-white space-y-5">
                <h2 className="text-lg font-bold text-[#333333]">Preset Configuration</h2>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="text-[#999999] block mb-1">Preset Name:</label>
                    <input
                      type="text"
                      value={activePreset.name}
                      onChange={(e) => setActivePreset({ ...activePreset, name: e.target.value })}
                      className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-2 text-[#333333]"
                    />
                  </div>

                  {/* 2257 Record Keeping Section */}
                  <div className="bg-white space-y-3 pt-2">
                    <span className="text-[#333333] font-bold uppercase tracking-wider text-[11px] block">
                      18 U.S.C. 2257 Record-Keeping Attestation
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#999999] block mb-1">Verified Records Vault ID:</label>
                        <input
                          type="text"
                          value={activePreset.recordsId2257}
                          onChange={(e) => setActivePreset({ ...activePreset, recordsId2257: e.target.value })}
                          className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333] font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[#999999] block mb-1">Records Custodian Contact:</label>
                        <input
                          type="text"
                          value={activePreset.custodianContact}
                          onChange={(e) => setActivePreset({ ...activePreset, custodianContact: e.target.value })}
                          className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-[#333333]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Pricing & Watermark */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[#999999] block mb-1">PPV Store Price (USD):</label>
                      <input
                        type="number"
                        step="0.01"
                        value={activePreset.ppvPriceUsd}
                        onChange={(e) => setActivePreset({ ...activePreset, ppvPriceUsd: Number(e.target.value) || 0 })}
                        className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-2 text-[#333333]"
                      />
                    </div>
                    <div>
                      <label className="text-[#999999] block mb-1">Watermark PNG Path:</label>
                      <input
                        type="text"
                        value={activePreset.watermarkPngPath}
                        onChange={(e) => setActivePreset({ ...activePreset, watermarkPngPath: e.target.value })}
                        className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-2 text-[#333333] font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="text-[#999999] block mb-1">Position:</label>
                      <select
                        value={activePreset.watermarkPosition}
                        onChange={(e) =>
                          setActivePreset({
                            ...activePreset,
                            watermarkPosition: e.target.value as PresetProfile["watermarkPosition"],
                          })
                        }
                        className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-2 text-[#333333]"
                      >
                        <option value="bottom-right">Bottom Right</option>
                        <option value="bottom-left">Bottom Left</option>
                        <option value="top-right">Top Right</option>
                        <option value="top-left">Top Left</option>
                      </select>
                    </div>
                  </div>

                  {/* 16-Tag Niche SEO Block */}
                  <div className="space-y-2 pt-2">
                    <label className="text-[#999999] font-bold block">
                      16-Tag Niche SEO Block (Applied across tube networks &amp; clip stores):
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <input
                          key={i}
                          type="text"
                          value={activePreset.seoTags[i] || ""}
                          onChange={(e) => handleTagChange(i, e.target.value)}
                          className="bg-white border-0 border-b border-[#cccccc] px-1 py-1 text-[11px] text-[#333333]"
                          placeholder={`Tag ${i + 1}`}
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSave}
                    className="border border-[#cccccc] w-full py-2.5 rounded bg-white text-[#333333] font-bold cursor-pointer"
                  >
                    Save &amp; Persist Preset
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
