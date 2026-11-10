"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Copy, Download, Printer, QrCode, Stethoscope, X } from "lucide-react";
import { useToast } from "@/components/providers";
import { Button, Modal } from "@/components/ui";

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  hospitalName: string;
  slug: string;
  city?: string | null;
}

export function ClinicQrModal({ open, onClose, hospitalName, slug, city }: QrModalProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const bookingUrl = typeof window !== "undefined"
    ? `${window.location.origin}/book/${slug}`
    : `https://tectha-demo.vercel.app/book/${slug}`;

  // QR Server generates a crisp, high-resolution SVG/PNG
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(bookingUrl)}`;

  function copyLink() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      toast.success("Booking link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clinic Reception QR Standee"
      subtitle="Patients can scan this with any smartphone camera to book or reschedule consultations."
    >
      <div className="space-y-6">
        {/* Printable Standee Preview */}
        <div className="print-card mx-auto max-w-[340px] rounded-3xl border-2 border-slate-200 bg-gradient-to-b from-white via-white to-violet-50/40 p-6 text-center shadow-md">
          {/* Clinic Header */}
          <div className="mb-4 flex flex-col items-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-xs">
              <Stethoscope className="size-6" />
            </div>
            <h3 className="mt-3 text-lg font-extrabold tracking-tight text-ink">{hospitalName}</h3>
            {city && <p className="text-xs font-semibold text-muted">{city}</p>}
          </div>

          {/* QR Code Container */}
          <div className="relative mx-auto size-56 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageUrl}
              alt="Scan to Book Appointment"
              className="size-full object-contain"
            />
          </div>

          {/* Instructions */}
          <div className="mt-4 space-y-1">
            <p className="text-sm font-extrabold text-violet-950">
              Scan to Book Consultation
            </p>
            <p className="text-[12px] font-semibold text-slate-500">
              மருத்துவரை சந்திக்க ஸ்கேன் செய்யவும்
            </p>
            <p className="pt-1 font-mono text-[11px] text-muted truncate">
              {bookingUrl.replace(/^https?:\/\//, "")}
            </p>
          </div>

          {/* Badge */}
          <div className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            TEC THA Follow-Up Engine
          </div>
        </div>

        {/* Action Controls */}
        <div className="no-print flex flex-wrap items-center justify-center gap-2 pt-2">
          <Button
            variant="secondary"
            icon={copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
            onClick={copyLink}
          >
            {copied ? "Copied Link!" : "Copy Direct Link"}
          </Button>
          <Button
            variant="primary"
            icon={<Printer className="size-4" />}
            onClick={handlePrint}
          >
            Print Standee (PDF)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

