'use client';

import React, { useState } from 'react';
import { PriorAuthResponse } from '@/types/priorAuth';

interface AnalysisResultViewProps {
  result: PriorAuthResponse | null;
  isLoading: boolean;
  payerName?: string;
}

export const AnalysisResultView: React.FC<AnalysisResultViewProps> = ({
  result,
  isLoading,
  payerName,
}) => {
  const [activeTab, setActiveTab] = useState<'checklist' | 'letter'>('checklist');
  const [copied, setCopied] = useState(false);

  const handleCopyLetter = async () => {
    if (!result?.justificationLetter) return;
    try {
      await navigator.clipboard.writeText(result.justificationLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy letter: ', err);
    }
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[#F8FAFC]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mb-4" />
        <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
          Evaluating Clinical Policy Guidelines...
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Comparing clinical documentation against policy criteria.
        </p>
      </div>
    );
  }

  // Empty State
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[#F8FAFC]">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
          No Verification Data
        </div>
        <p className="text-xs text-slate-500 max-w-xs">
          Select a Demo Case or click &quot;Verify Coverage&quot; to review clinical necessity criteria.
        </p>
      </div>
    );
  }

  const isApproved = result.status === 'APPROVED';

  return (
    <div className="flex flex-col h-full bg-[#F8FAFC]">
      {/* Top Status Bar - Full Width Solid */}
      <div
        className={`px-6 py-3.5 flex items-center justify-between shrink-0 text-white font-bold text-xs tracking-wider uppercase ${
          isApproved ? 'bg-emerald-600' : 'bg-amber-600'
        }`}
      >
        <span>
          {isApproved
            ? `STATUS: COVERAGE APPROVED (MATCH: ${result.matchScore}%)`
            : `STATUS: ACTION REQUIRED — MISSING CLINICAL REQUIREMENTS (${result.matchScore}% MET)`}
        </span>
        <span className="font-mono text-[11px] bg-black/20 px-2 py-0.5 rounded">
          {result.citation.payerName || payerName || 'Payer Policy'}
        </span>
      </div>

      {/* Missing Requirements Alert (if any) */}
      {result.missingRequirements && result.missingRequirements.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 shrink-0">
          <div className="text-[11px] font-bold uppercase text-amber-900 mb-1">
            Missing Mandatory Items:
          </div>
          <ul className="list-disc list-inside text-xs text-amber-800 space-y-0.5">
            {result.missingRequirements.map((req, idx) => (
              <li key={idx}>{req}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 2-Tab Navigation Header */}
      <div className="flex border-b border-slate-200 bg-white px-6 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('checklist')}
          className={`py-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
            activeTab === 'checklist'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          Policy Checklist ({result.checklist?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('letter')}
          className={`py-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
            activeTab === 'letter'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          Medical Necessity Letter
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 p-6 overflow-y-auto">
        {/* Tab 1: Checklist & Policy Citation */}
        {activeTab === 'checklist' && (
          <div className="space-y-6">
            {/* Checklist Table */}
            <div className="border border-slate-200 rounded overflow-hidden bg-white shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="p-3 w-3/5">Policy Requirement</th>
                    <th className="p-3 w-1/5 text-center">Status</th>
                    <th className="p-3 w-2/5">Clinical Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {result.checklist?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="p-3 font-semibold text-slate-800 align-top">
                        {item.requirement}
                      </td>
                      <td className="p-3 text-center align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            item.met
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {item.met ? 'Satisfied' : 'Missing'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 font-mono text-[11px] align-top bg-slate-50/50">
                        {item.evidenceOrNote || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Policy Citation Box */}
            <div className="border border-slate-200 rounded bg-white p-4 space-y-2 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Payer Policy Citation Reference
              </div>
              <div className="text-xs font-bold text-slate-900">
                {result.citation.policyDocument} —{' '}
                <span className="text-slate-600 font-normal">
                  {result.citation.clauseSection}
                </span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded font-serif italic text-xs text-slate-700 leading-relaxed">
                &ldquo;{result.citation.exactTextSnippet}&rdquo;
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Medical Necessity Letter */}
        {activeTab === 'letter' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Generated Justification Letter
              </span>
              <button
                type="button"
                onClick={handleCopyLetter}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold tracking-wide uppercase transition-colors cursor-pointer"
              >
                {copied ? 'Copied to Clipboard' : 'Copy Letter'}
              </button>
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded font-mono text-xs text-slate-800 leading-relaxed whitespace-pre-wrap shadow-sm select-text">
              {result.justificationLetter}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
