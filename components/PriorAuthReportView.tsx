'use client';

import React, { useState } from 'react';
import {
  Printer,
  Copy,
  Check,
  X,
  FileCheck,
  ShieldCheck,
  AlertTriangle,
  Quote,
  FileText,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface PriorAuthReportData {
  status: 'APPROVED' | 'ACTION_REQUIRED' | 'REJECTED';
  matchScore: number;
  payer: string;
  policyTitle?: string;
  checklist: Array<{
    requirement: string;
    met: boolean;
    sectionClause: string;
    exactPolicyQuote: string;
    patientEvidence: string;
  }>;
  missingRequirements: string[];
  justificationLetter: string;
  summaryMessage?: string;
}

interface PriorAuthReportViewProps {
  report: PriorAuthReportData | null;
  onClose: () => void;
}

export const PriorAuthReportView: React.FC<PriorAuthReportViewProps> = ({
  report,
  onClose,
}) => {
  const { language, t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [issuedDate] = useState(() => new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US'));
  const [docRef] = useState(() => `PA-${Date.now().toString().slice(-6)}`);

  if (!report) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report.justificationLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy document:', err);
    }
  };

  const isApproved = report.status === 'APPROVED';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 lg:p-8 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-lg shadow-2xl flex flex-col overflow-hidden border border-slate-300">
        {/* Top Modal Toolbar (Hidden in Print) */}
        <div className="no-print p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-slate-800" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
              {t('packetTitle')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t('copiedLabel') : t('copyText')}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{t('exportPdf')}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-900 transition-colors"
              title={t('closeButton')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Official Medical Necessity Document */}
        <div
          id="printable-prior-auth-report"
          className="flex-1 overflow-y-auto p-8 bg-white text-slate-900 space-y-6 text-xs leading-relaxed"
        >
          {/* Document Letterhead */}
          <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-base font-extrabold tracking-tight uppercase text-slate-900">
                {t('medicalNecessityTitle')}
              </h1>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t('targetPayer')} <span className="ltr-isolate">{report.payer}</span>{' '}
                {report.policyTitle ? `— ${report.policyTitle}` : ''}
              </p>
            </div>
            <div className="text-end text-[11px] text-slate-600">
              <div>{t('date')} {issuedDate}</div>
              <div>{t('docRef')} <span className="ltr-isolate">{docRef}</span></div>
            </div>
          </div>

          {/* Determination Status Banner */}
          <div
            className={`p-4 rounded border flex items-center justify-between ${
              isApproved
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-3">
              {isApproved ? (
                <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
              )}
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider">
                  {isApproved
                    ? t('determinationApproved', { n: report.matchScore })
                    : t('determinationAction', { n: report.matchScore })}
                </div>
                <div className="text-[11px] opacity-90 mt-0.5">
                  {t('evaluatedStrictly')}
                </div>
              </div>
            </div>
          </div>

          {/* Missing Clinical Requirements (if any) */}
          {report.missingRequirements && report.missingRequirements.length > 0 && (
            <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded">
              <div className="text-[11px] font-bold uppercase text-amber-900 mb-1">
                {t('outstandingRequirements')}
              </div>
              <ul className="list-disc list-inside text-amber-800 space-y-0.5" dir="auto">
                {report.missingRequirements.map((req, i) => (
                  <li key={i}>{req}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Itemized Policy Criteria & Citations Table */}
          {report.checklist && report.checklist.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                {t('itemizedCriteria')}
              </div>
              <table className="w-full border-collapse border border-slate-200 text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase">
                    <th className="p-2.5 text-start border-e border-slate-200 w-1/4">{t('policyRequirement')}</th>
                    <th className="p-2.5 text-center border-e border-slate-200 w-20">{t('status')}</th>
                    <th className="p-2.5 text-start border-e border-slate-200 w-1/3">{t('policyCitationQuote')}</th>
                    <th className="p-2.5 text-start">{t('clinicalChartEvidence')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.checklist.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-2.5 font-semibold text-slate-800 border-e border-slate-200 align-top" dir="auto">
                        {item.requirement}
                      </td>
                      <td className="p-2.5 text-center border-e border-slate-200 align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.met
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {item.met ? t('satisfied') : t('missing')}
                        </span>
                      </td>
                      <td className="p-2.5 border-e border-slate-200 align-top bg-slate-50/40">
                        <div className="font-bold text-[10px] text-slate-700 mb-1 ltr-isolate">
                          {item.sectionClause}
                        </div>
                        <div className="text-[11px] italic font-serif text-slate-600 ltr-isolate">
                          &ldquo;{item.exactPolicyQuote}&rdquo;
                        </div>
                      </td>
                      <td className="p-2.5 text-[11px] text-slate-700 align-top" dir="auto">
                        {item.patientEvidence || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Physician Medical Necessity Justification Document */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              {t('attendingStatement')}
            </div>
            <div
              className="p-4 border border-slate-200 rounded text-xs text-slate-900 bg-slate-50/40 whitespace-pre-wrap leading-relaxed shadow-sm"
              dir="auto"
            >
              {report.justificationLetter}
            </div>
          </div>

          {/* Attending Physician Signature Area */}
          <div className="pt-8 border-t border-slate-200 flex items-end justify-between">
            <div className="space-y-1">
              <div className="font-bold text-slate-900">{t('signatureLabel')}</div>
              <div className="text-slate-500 text-[11px]">{t('npiLicense')}</div>
            </div>
            <div className="text-end">
              <div className="w-48 border-b border-slate-400 mb-1" />
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                {t('physicianSignatureDate')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};