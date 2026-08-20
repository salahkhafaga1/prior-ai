'use client';

import React from 'react';
import { MOCK_CASES } from '@/data/mockCases';

interface HeaderProps {
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
  onReset: () => void;
  isAnalyzing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  selectedCaseId,
  onSelectCase,
  onReset,
  isAnalyzing,
}) => {
  return (
    <header className="w-full bg-white border-b border-slate-200 px-6 py-3 shrink-0">
      <div className="flex items-center justify-between">
        {/* Minimalist Logo */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-slate-900 flex items-center justify-center text-white font-bold text-xs tracking-wider">
            PA
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">
              PriorAuth <span className="text-slate-400 font-normal">/</span> Verify
            </h1>
          </div>
        </div>

        {/* Demo Switchers & Reset */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectCase(MOCK_CASES[0].id)}
            disabled={isAnalyzing}
            className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer ${
              selectedCaseId === MOCK_CASES[0].id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Demo Case 1 (Approved)
          </button>

          <button
            type="button"
            onClick={() => onSelectCase(MOCK_CASES[1].id)}
            disabled={isAnalyzing}
            className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer ${
              selectedCaseId === MOCK_CASES[1].id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Demo Case 2 (Missing Info)
          </button>

          <button
            type="button"
            onClick={onReset}
            disabled={isAnalyzing}
            className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </header>
  );
};
