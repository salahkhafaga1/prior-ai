'use client';

import React from 'react';
import { PAYER_OPTIONS } from '@/data/mockCases';

interface PatientInputFormProps {
  patientNote: string;
  setPatientNote: (note: string) => void;
  payerId: string;
  setPayerId: (payer: string) => void;
  procedure: string;
  setProcedure: (proc: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export const PatientInputForm: React.FC<PatientInputFormProps> = ({
  patientNote,
  setPatientNote,
  payerId,
  setPayerId,
  procedure,
  setProcedure,
  onSubmit,
  isLoading,
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientNote.trim() || isLoading) return;
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full bg-white p-6 space-y-5">
      {/* Target Payer Segmented Bar */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
          Target Insurance Payer
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded border border-slate-200">
          {PAYER_OPTIONS.map((p) => {
            const isSelected = payerId.toLowerCase() === p.id.toLowerCase();
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPayerId(p.id)}
                className={`py-1.5 px-2 rounded text-xs font-semibold text-center transition-all cursor-pointer truncate ${
                  isSelected
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title={p.name}
              >
                {p.name.split('(')[0].trim()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Procedure Requested */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
          Requested Procedure & CPT
        </label>
        <input
          type="text"
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          placeholder="e.g. MRI Lumbar Spine without Contrast (CPT 72148)"
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-xs text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-medium"
        />
      </div>

      {/* Clinical Progress Note Textarea */}
      <div className="flex flex-col flex-1 min-h-[300px]">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Clinical Encounter Chart Note
          </label>
          <span className="text-[11px] text-slate-400 font-mono">
            {patientNote.trim() ? patientNote.trim().split(/\s+/).length : 0} words
          </span>
        </div>
        <textarea
          value={patientNote}
          onChange={(e) => setPatientNote(e.target.value)}
          placeholder="Paste full clinical encounter note including HPI, physical exam, and prior conservative therapy trials..."
          className="w-full flex-1 p-3.5 bg-slate-50 border border-slate-300 rounded text-xs text-slate-900 font-mono leading-relaxed placeholder-slate-400 focus:bg-white focus:border-slate-900 focus:ring-1 focus:ring-slate-900 resize-none"
        />
      </div>

      {/* Action Button */}
      <button
        type="submit"
        disabled={isLoading || !patientNote.trim()}
        className={`w-full py-3 px-4 rounded text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
          isLoading || !patientNote.trim()
            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
            : 'bg-slate-900 text-white hover:bg-slate-800'
        }`}
      >
        {isLoading ? 'Analyzing Clinical Criteria...' : 'Verify Coverage'}
      </button>
    </form>
  );
};
