"use client";

import { useMemo, useState } from "react";
import {
  Banknote, Calculator, Check, Copy, HeartHandshake, HelpCircle,
  IndianRupee, Sparkles, TrendingUp, Users,
} from "lucide-react";
import { useToast } from "@/components/providers";
import { Button, Card, CardHeader } from "@/components/ui";

const PRESETS = [
  { name: "General OPD", fee: 400, volume: 150, baseline: 35, withEngine: 75 },
  { name: "Dermatology", fee: 800, volume: 200, baseline: 30, withEngine: 78 },
  { name: "Cardiology", fee: 1200, volume: 180, baseline: 40, withEngine: 82 },
  { name: "Dental Clinic", fee: 600, volume: 120, baseline: 32, withEngine: 76 },
];

export function RoiCalculator() {
  const toast = useToast();
  const [fee, setFee] = useState<number>(500);
  const [volume, setVolume] = useState<number>(160);
  const [baselineRate, setBaselineRate] = useState<number>(35);
  const [engineRate, setEngineRate] = useState<number>(78);
  const [copied, setCopied] = useState(false);

  // Computations
  const stats = useMemo(() => {
    const baselinePatients = Math.round((volume * baselineRate) / 100);
    const enginePatients = Math.round((volume * engineRate) / 100);
    const recoveredPatients = Math.max(0, enginePatients - baselinePatients);
    const monthlyRecovery = recoveredPatients * fee;
    const annualRecovery = monthlyRecovery * 12;
    const percentageBoost = baselinePatients > 0 ? Math.round(((enginePatients - baselinePatients) / baselinePatients) * 100) : 0;

    return {
      baselinePatients,
      enginePatients,
      recoveredPatients,
      monthlyRecovery,
      annualRecovery,
      percentageBoost,
    };
  }, [fee, volume, baselineRate, engineRate]);

  function applyPreset(p: typeof PRESETS[number]) {
    setFee(p.fee);
    setVolume(p.volume);
    setBaselineRate(p.baseline);
    setEngineRate(p.withEngine);
    toast.success(`Loaded "${p.name}" preset`);
  }

  function copySummary() {
    const text = `TEC THA Follow-Up Engine ROI Projection:
• Clinic Follow-Ups: ${volume}/month
• Consultation Fee: ₹${fee}
• Baseline Return Rate: ${baselineRate}% (${stats.baselinePatients} patients)
• Return Rate with TEC THA: ${engineRate}% (${stats.enginePatients} patients)
• Recovered Patients: +${stats.recoveredPatients} patients/month (+${stats.percentageBoost}%)
• Monthly Revenue Recovered: ₹${stats.monthlyRecovery.toLocaleString("en-IN")}
• Annual Revenue Protection: ₹${stats.annualRecovery.toLocaleString("en-IN")}/year`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("ROI summary copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Card className="overflow-hidden border-violet-200/90 shadow-md">
      <CardHeader
        icon={<Calculator className="size-5 text-violet-700" />}
        title="Follow-Up Revenue Recovery Estimator"
        subtitle="Simulate how automated WhatsApp reminders and overdue call alerts protect patient retention and clinic revenue."
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
            onClick={copySummary}
          >
            {copied ? "Copied!" : "Copy Summary"}
          </Button>
        }
      />

      <div className="p-5 sm:p-6 space-y-6">
        {/* Preset Selector */}
        <div>
          <span className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">
            Clinic Presets:
          </span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-xs font-bold text-ink-2 hover:border-violet-300 hover:bg-violet-50/60 hover:text-violet-900 transition-all cursor-pointer shadow-2xs"
              >
                {p.name} (₹{p.fee})
              </button>
            ))}
          </div>
        </div>

        {/* Sliders Grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Fee */}
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="fee-slider" className="text-xs font-bold text-ink-2 uppercase tracking-wide">
                Consultation / Visit Fee (₹)
              </label>
              <span className="tabular font-mono text-base font-extrabold text-violet-700">
                ₹{fee.toLocaleString("en-IN")}
              </span>
            </div>
            <input
              id="fee-slider"
              type="range"
              min="200"
              max="2500"
              step="50"
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              className="w-full accent-violet-700 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-muted mt-1">
              <span>₹200</span>
              <span>₹1,000</span>
              <span>₹2,500</span>
            </div>
          </div>

          {/* Monthly Follow-up Volume */}
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="volume-slider" className="text-xs font-bold text-ink-2 uppercase tracking-wide">
                Monthly Follow-Ups Scheduled
              </label>
              <span className="tabular font-mono text-base font-extrabold text-violet-700">
                {volume} patients
              </span>
            </div>
            <input
              id="volume-slider"
              type="range"
              min="30"
              max="500"
              step="10"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-violet-700 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-muted mt-1">
              <span>30 patients</span>
              <span>250 patients</span>
              <span>500 patients</span>
            </div>
          </div>

          {/* Baseline Return Rate */}
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="baseline-slider" className="text-xs font-bold text-ink-2 uppercase tracking-wide">
                Current Return Rate (Without Reminders)
              </label>
              <span className="tabular font-mono text-base font-extrabold text-rose-600">
                {baselineRate}%
              </span>
            </div>
            <input
              id="baseline-slider"
              type="range"
              min="15"
              max="60"
              step="5"
              value={baselineRate}
              onChange={(e) => setBaselineRate(Number(e.target.value))}
              className="w-full accent-rose-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-muted mt-1">
              <span>15%</span>
              <span>35% (Avg clinic)</span>
              <span>60%</span>
            </div>
          </div>

          {/* Return Rate With Engine */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="engine-slider" className="text-xs font-bold text-emerald-900 uppercase tracking-wide">
                Return Rate With TEC THA Reminders
              </label>
              <span className="tabular font-mono text-base font-extrabold text-emerald-700">
                {engineRate}%
              </span>
            </div>
            <input
              id="engine-slider"
              type="range"
              min="50"
              max="95"
              step="1"
              value={engineRate}
              onChange={(e) => setEngineRate(Number(e.target.value))}
              className="w-full accent-emerald-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-emerald-800/80 mt-1">
              <span>50%</span>
              <span>75% (Target)</span>
              <span>95%</span>
            </div>
          </div>
        </div>

        {/* Results Banner */}
        <div className="rounded-3xl border border-violet-200/90 bg-gradient-to-br from-[#12141c] via-[#1a1c29] to-[#251f38] p-6 text-white shadow-lg">
          <div className="flex items-center gap-2 text-xs font-bold text-violet-400 uppercase tracking-wider mb-4">
            <Sparkles className="size-4 text-violet-400" />
            Projected Hospital Revenue Recovery
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* Metric 1 */}
            <div className="rounded-2xl bg-white/5 p-4 border border-white/10 backdrop-blur-xs">
              <span className="block text-xs font-medium text-slate-300">Patients Recovered</span>
              <span className="tabular font-mono text-2xl sm:text-3xl font-extrabold text-white mt-1 block">
                +{stats.recoveredPatients}
              </span>
              <span className="text-[11px] text-emerald-400 font-semibold mt-1 block">
                +{stats.percentageBoost}% increase
              </span>
            </div>

            {/* Metric 2 */}
            <div className="rounded-2xl bg-white/5 p-4 border border-white/10 backdrop-blur-xs">
              <span className="block text-xs font-medium text-slate-300">Monthly Revenue</span>
              <span className="tabular font-mono text-2xl sm:text-3xl font-extrabold text-emerald-400 mt-1 block">
                ₹{stats.monthlyRecovery.toLocaleString("en-IN")}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                Per month saved
              </span>
            </div>

            {/* Metric 3 */}
            <div className="rounded-2xl bg-white/5 p-4 border border-white/10 backdrop-blur-xs">
              <span className="block text-xs font-medium text-slate-300">Annual Protection</span>
              <span className="tabular font-mono text-2xl sm:text-3xl font-extrabold text-violet-300 mt-1 block">
                ₹{stats.annualRecovery.toLocaleString("en-IN")}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                12-month projection
              </span>
            </div>

            {/* Metric 4 */}
            <div className="rounded-2xl bg-white/5 p-4 border border-white/10 backdrop-blur-xs">
              <span className="block text-xs font-medium text-slate-300">Total Returned</span>
              <span className="tabular font-mono text-2xl sm:text-3xl font-extrabold text-white mt-1 block">
                {stats.enginePatients} <span className="text-sm font-normal text-slate-400">/ {volume}</span>
              </span>
              <span className="text-[11px] text-violet-400 font-semibold mt-1 block">
                {engineRate}% total retention
              </span>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-400 leading-relaxed">
            *Based on day-before, 7-day and 3-day WhatsApp reminders with 1-tap Confirm / Reschedule actions, combined with red-alert overdue staff outreach.
          </p>
        </div>
      </div>
    </Card>
  );
}

