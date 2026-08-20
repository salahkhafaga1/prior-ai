'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  FileCheck,
  Printer,
  ShieldCheck,
  AlertTriangle,
  BookOpen,
  X,
  Plus,
  Quote,
  UploadCloud,
  Copy,
  Check,
  Terminal,
  ChevronDown,
  ChevronUp,
  Languages,
} from 'lucide-react';
import { PriorAuthReportData } from '@/components/PriorAuthReportView';
import { ProcessedImageAttachment, ImageAttachmentRequest } from '@/types/imageProcessing';
import { useLanguage } from '@/lib/i18n/LanguageContext';

async function parseJsonResponse<T extends object>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(
      `Server returned a non-JSON response (HTTP ${res.status}). ${text || 'This usually means the serverless function timed out or crashed.'}`
    );
  }
  return res.json() as Promise<T>;
}

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

interface ChatApiResponse {
  success?: boolean;
  error?: string;
  errorCode?: string;
  message?: string;
  details?: string;
  source?: string;
  payer?: string;
  policyTitle?: string;
  modelUsed?: string;
  responseLanguage?: string;
  status?: 'APPROVED' | 'ACTION_REQUIRED' | 'REJECTED';
  matchScore?: number;
  summary?: string;
  summaryMessage?: string;
  checklist?: PriorAuthReportData['checklist'];
  missingRequirements?: string[];
  justificationLetter?: string;
  attachments?: ProcessedImageAttachment[];
}

export interface DiagnosticErrorInfo {
  source: string;
  errorCode: string;
  message: string;
  details?: string;
}

export interface AttachedImageInfo {
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reportData?: PriorAuthReportData;
  timestamp: string;
  attachmentName?: string;
  imageAttachments?: AttachedImageInfo[];
  attachments?: ProcessedImageAttachment[];
  errorInfo?: DiagnosticErrorInfo;
}

interface ChatWorkspaceProps {
  onOpenPolicyLibrary: () => void;
  onViewReport: (report: PriorAuthReportData) => void;
  activePayerTag: string;
  setActivePayerTag: (tag: string) => void;
  payersRefreshKey?: number;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  onOpenPolicyLibrary,
  onViewReport,
  activePayerTag,
  setActivePayerTag,
  payersRefreshKey,
}) => {
  const { language, t, translateServerError, toggleLanguage } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImageInfo[]>([]);
  const [availablePayers, setAvailablePayers] = useState<string[]>([]);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadPayers = async () => {
    try {
      console.log('[SUPABASE LOG] Fetching available payers for tag bar...');
      const res = await fetch('/api/policy/payers');
      if (res.ok) {
        const data = await parseJsonResponse<{ payers?: string[] }>(res);
        const payers = data.payers || [];
        setAvailablePayers(payers);
        if (payers.length > 0 && !activePayerTag) {
          setActivePayerTag(`@${payers[0]}`);
        }
      }
    } catch (err) {
      console.error('[SUPABASE LOG] Error loading payers:', err);
    }
  };

  useEffect(() => {
    loadPayers();
  }, [payersRefreshKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleCopyDiagnostic = async (msgId: string, error: DiagnosticErrorInfo) => {
    const logText = `--- PRIORAUTH DIAGNOSTIC LOG ---
Timestamp: ${new Date().toISOString()}
Source: ${error.source}
Error Code: ${error.errorCode}
Message: ${error.message}
Details: ${error.details || 'N/A'}
---------------------------------`;

    try {
      await navigator.clipboard.writeText(logText);
      setCopiedLogId(msgId);
      setTimeout(() => setCopiedLogId(null), 2500);
    } catch (err) {
      console.error('Failed to copy error log:', err);
    }
  };

  const toggleDetails = (msgId: string) => {
    setExpandedDetails((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputPrompt;
    if (!textToSend.trim() && !attachedFile && attachedImages.length === 0) return;

    const fullMessageText = attachedFile
      ? `${textToSend}\n\n[ATTACHED CLINICAL FILE: ${attachedFile.name}]\n${attachedFile.content}`
      : textToSend;

    const imagesPayload: ImageAttachmentRequest[] = attachedImages.map((img) => ({
      fileName: img.name,
      mimeType: img.mimeType,
      data: img.dataUrl.split(',')[1] || '',
      sizeBytes: img.sizeBytes,
    }));

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content:
        textToSend ||
        (attachedImages.length > 0
          ? `${t('uploadedImages')} ${attachedImages.map((i) => i.name).join(', ')}`
          : `${t('uploadedChart')} ${attachedFile?.name}`),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      attachmentName: attachedFile?.name,
      imageAttachments: attachedImages,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputPrompt('');
    setAttachedFile(null);
    setAttachedImages([]);
    setIsLoading(true);

    try {
      console.log('[RAG ENGINE LOG] Dispatching clinical evaluation to /api/chat...');
      const requestBody = JSON.stringify({
        message: fullMessageText,
        payer: activePayerTag.replace('@', ''),
        images: imagesPayload,
        language,
      });

      const payloadBytes = new TextEncoder().encode(requestBody).length;
      if (payloadBytes > MAX_PAYLOAD_BYTES) {
        console.error('[RAG ENGINE LOG] Request payload exceeds platform limit:', payloadBytes);
        const errorInfo: DiagnosticErrorInfo = {
          source: '[RAG Pipeline]',
          errorCode: 'PAYLOAD_TOO_LARGE',
          message: t('errPayloadTooLarge'),
          details: `Status code: ${(payloadBytes / 1048576).toFixed(1)} MB sent.`,
        };
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-err-${Date.now()}`,
            role: 'assistant',
            content: errorInfo.message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            errorInfo,
          },
        ]);
        return;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      const rawRes = res.clone();
      let data: ChatApiResponse = {};
      let parseFailed = false;
      try {
        data = await parseJsonResponse<ChatApiResponse>(res);
      } catch {
        parseFailed = true;
        data = {} as ChatApiResponse;
      }

      if (!res.ok || parseFailed || data.success === false || data.error) {
        let rawBody = '';
        try {
          rawBody = (await rawRes.text()).slice(0, 500);
        } catch {
          rawBody = '';
        }
        console.error('[RAG ENGINE LOG] API returned error:', { status: res.status, data, rawBody });
        const serverMessage = data.message || data.error || `Server returned HTTP ${res.status} with no readable error message.`;
        const errorInfo: DiagnosticErrorInfo = {
          source: data.source || '[RAG Pipeline]',
          errorCode: data.errorCode || `HTTP_${res.status}`,
          message: translateServerError(data.errorCode, serverMessage),
          details: data.details || `Status code ${res.status}${rawBody ? ` — ${rawBody}` : ''}`,
        };

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-err-${Date.now()}`,
            role: 'assistant',
            content: errorInfo.message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            errorInfo,
          },
        ]);
        return;
      }

      console.log('[RAG ENGINE LOG] Received evaluation result:', data);
      const summaryText = data.summary || data.summaryMessage || t('errDefault');

      const reportData: PriorAuthReportData = {
        status: data.status || 'ACTION_REQUIRED',
        matchScore: data.matchScore ?? 0,
        payer: data.payer || activePayerTag.replace('@', ''),
        policyTitle: data.policyTitle,
        checklist: data.checklist || [],
        missingRequirements: data.missingRequirements || [],
        justificationLetter: data.justificationLetter || '',
        summaryMessage: summaryText,
      };

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: summaryText,
        reportData,
        attachments: data.attachments || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('[RAG ENGINE LOG] Network exception:', err);
      const errorInfo: DiagnosticErrorInfo = {
        source: '[RAG Pipeline]',
        errorCode: 'NETWORK_EXCEPTION',
        message: t('errDefault'),
        details: err?.message || String(err),
      };

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-err-${Date.now()}`,
          role: 'assistant',
          content: errorInfo.message,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          errorInfo,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setAttachedImages((prev) => [
          ...prev,
          {
            name: file.name,
            mimeType: file.type || 'image/png',
            dataUrl: dataUrl || '',
            sizeBytes: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setAttachedFile({
        name: file.name,
        content: text || '',
      });
    };
    reader.readAsText(file);
  };

  const handleInsertTag = (tag: string) => {
    setActivePayerTag(tag);
    if (!inputPrompt.includes(tag)) {
      setInputPrompt((prev) => `${tag} ${prev}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAFBFC] overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-slate-900 rounded flex items-center justify-center text-white font-bold text-xs">
            PA
          </div>
          <div>
            <h1 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              {t('appTitle')} <span className="text-slate-400 font-normal">{t('prodRagTag')}</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLanguage}
            className="px-2.5 py-1.5 rounded text-[11px] font-bold border border-slate-300 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Switch UI language"
          >
            <Languages className="w-3.5 h-3.5" />
            <span dir="ltr" className="tracking-wide">{t('langSwitch')}</span>
          </button>
          <button
            type="button"
            onClick={onOpenPolicyLibrary}
            className="px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t('openPolicyLibrary')}</span>
            {availablePayers.length > 0 && (
              <span className="ms-1 px-1.5 py-0.2 bg-slate-900 text-white rounded-full text-[10px]">
                {availablePayers.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-6">
        {messages.length === 0 ? (
          /* Empty State */
          <div className="max-w-2xl mx-auto my-auto py-16 text-center space-y-6">
            <div className="w-12 h-12 bg-slate-900 text-white rounded-xl flex items-center justify-center mx-auto shadow-sm">
              <FileCheck className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                {t('emptyTitle')}
              </h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                {t('emptyDescription')}
              </p>
            </div>

            {availablePayers.length === 0 ? (
              /* No Policies Warning Banner */
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-start max-w-md mx-auto space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{t('noPoliciesTitle')}</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  {t('noPoliciesDesc')}
                </p>
                <button
                  type="button"
                  onClick={onOpenPolicyLibrary}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('uploadPolicyBtn')}</span>
                </button>
              </div>
            ) : (
              /* Instructions with Available Payers */
              <div className="p-4 bg-white border border-slate-200 rounded-lg text-start max-w-md mx-auto space-y-2 shadow-sm">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  {t('activePayersTitle')}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {availablePayers.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleInsertTag(`@${p}`)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 rounded text-xs font-semibold cursor-pointer"
                    >
                      <span dir="ltr">@{p}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 pt-1">
                  {t('payersHint')}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Active Chat Conversation */
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                {/* Message Header */}
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1 px-1">
                  {m.role === 'user' ? t('physician') : t('engine')} • {m.timestamp}
                </div>

                {/* Message Card */}
                {m.role === 'user' ? (
                  <div className="bg-slate-900 text-white rounded-lg p-4 text-xs max-w-2xl leading-relaxed whitespace-pre-wrap shadow-sm" dir="auto">
                    {m.content}
                    {m.attachmentName && (
                      <div className="mt-2 pt-2 border-t border-slate-700 text-[11px] text-slate-300 flex items-center gap-1.5">
                        <Paperclip className="w-3 h-3" />
                        <span>{t('attachedRecord')} <span dir="ltr">{m.attachmentName}</span></span>
                      </div>
                    )}
                    {m.imageAttachments && m.imageAttachments.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-700 flex flex-wrap gap-2">
                        {m.imageAttachments.map((img, i) => (
                          <img
                            key={i}
                            src={img.dataUrl}
                            alt={img.name}
                            className="w-16 h-16 object-cover rounded border border-slate-600"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : m.errorInfo ? (
                  /* Diagnostic Error Banner */
                  <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-5 text-xs text-rose-950 w-full max-w-2xl space-y-3 shadow-md">
                    <div className="flex items-center justify-between border-b border-rose-200 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-rose-200 text-rose-900 font-mono font-bold text-[10px] rounded">
                          <span dir="ltr">{m.errorInfo.source}</span>
                        </span>
                        <span className="font-mono font-extrabold text-[11px] text-rose-700">
                          <span dir="ltr">{m.errorInfo.errorCode}</span>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyDiagnostic(m.id, m.errorInfo!)}
                        className="px-2.5 py-1 bg-white border border-rose-300 hover:bg-rose-100 rounded text-[10px] font-bold text-rose-800 flex items-center gap-1 transition-colors cursor-pointer"
                        title="Copy diagnostic error log for troubleshooting"
                      >
                        {copiedLogId === m.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>{t('logCopied')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>{t('copyLog')}</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="font-bold text-xs text-rose-900 leading-snug">
                      {m.errorInfo.message}
                    </div>

                    {m.errorInfo.details && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => toggleDetails(m.id)}
                          className="text-[10px] font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 cursor-pointer"
                        >
                          <Terminal className="w-3 h-3" />
                          <span>{expandedDetails[m.id] ? t('hideTechDetails') : t('showTechDetails')}</span>
                          {expandedDetails[m.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {expandedDetails[m.id] && (
                          <div className="p-3 bg-white/90 border border-rose-200 rounded font-mono text-[10px] text-rose-800 whitespace-pre-wrap break-all shadow-inner leading-relaxed">
                            {m.errorInfo.details}
                          </div>
                        )}
                      </div>
                    )}

                    {(m.errorInfo.errorCode === 'NO_PAYER_MATCH' ||
                      m.errorInfo.errorCode === 'NO_PAYERS_IN_DATABASE') && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={onOpenPolicyLibrary}
                          className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        >
                          <UploadCloud className="w-3.5 h-3.5" />
                          <span>{t('openPolicyLibraryShort')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Standard Result Card */
                  <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs text-slate-900 w-full space-y-4 shadow-sm">
                    {/* Status Strip */}
                    {m.reportData && (
                      <div
                        className={`p-3 rounded border flex items-center justify-between ${
                          m.reportData.status === 'APPROVED'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            : 'bg-amber-50 border-amber-300 text-amber-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {m.reportData.status === 'APPROVED' ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          )}
                          <span className="font-bold uppercase tracking-wider text-xs">
                            {m.reportData.status === 'APPROVED'
                              ? t('coverageApproved', { n: m.reportData.matchScore })
                              : t('actionRequired', { n: m.reportData.matchScore })}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] bg-black/10 px-2 py-0.5 rounded font-bold">
                          <span dir="ltr">{m.reportData.payer}</span>
                        </span>
                      </div>
                    )}

                    {/* Summary Message */}
                    <div className="leading-relaxed text-slate-700 font-medium" dir="auto">
                      {m.content}
                    </div>

                    {/* Missing Requirements Box */}
                    {m.reportData?.missingRequirements && m.reportData.missingRequirements.length > 0 && (
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded text-amber-900 space-y-1">
                        <div className="font-bold text-[11px] uppercase">
                          {t('documentationGaps')}
                        </div>
                        <ul className="list-disc list-inside text-xs space-y-0.5" dir="auto">
                          {m.reportData.missingRequirements.map((gap, i) => (
                            <li key={i}>{gap}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Criteria Checklist with Citations */}
                    {m.reportData?.checklist && m.reportData.checklist.length > 0 && (
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t('criteriaCitations')}
                        </div>
                        <div className="space-y-2">
                          {m.reportData.checklist.map((c, i) => (
                            <div
                              key={i}
                              className="p-3 rounded bg-slate-50 border border-slate-200 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-900" dir="auto">
                                  {c.requirement}
                                </span>
                                <span
                                  className={`font-bold uppercase px-2 py-0.5 rounded text-[10px] shrink-0 ${
                                    c.met
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-900'
                                  }`}
                                >
                                  {c.met ? t('satisfied') : t('missing')}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-100 space-y-1">
                                <div className="font-semibold text-slate-700">
                                  {t('clause')} <span className="font-mono text-slate-900" dir="ltr">{c.sectionClause}</span>
                                </div>
                                <div className="italic font-serif text-slate-600" dir="ltr">
                                  &ldquo;{c.exactPolicyQuote}&rdquo;
                                </div>
                              </div>

                              <div className="text-[11px] text-slate-700 ps-1" dir="auto">
                                <span className="font-bold text-slate-500">{t('chartEvidence')}</span> {c.patientEvidence}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Attached Image Processing Results */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t('attachedImageProcessing')}
                        </div>
                        {m.attachments.map((att, i) => (
                          <div
                            key={i}
                            className="p-3 rounded bg-slate-50 border border-slate-200 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 truncate" dir="ltr">{att.fileName}</span>
                              <span
                                className={`font-bold uppercase px-2 py-0.5 rounded text-[10px] shrink-0 ${
                                  att.processingStatus === 'SUCCESS'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : att.processingStatus === 'PARTIAL'
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {att.processingStatus}
                              </span>
                            </div>

                            {att.ocrText && (
                              <details className="text-[11px]">
                                <summary className="font-bold text-slate-700 cursor-pointer">
                                  {t('ocrText', { n: att.ocrText.length })}
                                </summary>
                                <pre className="mt-1 p-2 bg-white border border-slate-100 rounded font-mono text-slate-700 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto" dir="auto">
                                  {att.ocrText}
                                </pre>
                              </details>
                            )}

                            {att.imageDescription && (
                              <details className="text-[11px]" open={att.ocrText ? false : true}>
                                <summary className="font-bold text-slate-700 cursor-pointer">
                                  {t('imageUnderstanding')}
                                </summary>
                                <div className="mt-1 p-2 bg-white border border-slate-100 rounded text-slate-600 leading-relaxed" dir="auto">
                                  {att.imageDescription}
                                </div>
                              </details>
                            )}

                            {att.error && (
                              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-1.5">
                                {att.error.phase === 'ocr' ? t('ocrFailed') : t('imageUnderstandingFailed')} {t('failed')}{' '}
                                {att.error.message}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Report Export Triggers */}
                    {m.reportData && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => onViewReport(m.reportData!)}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                          <span>{t('viewOfficialPacket')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onViewReport(m.reportData!);
                            setTimeout(() => window.print(), 350);
                          }}
                          className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>{t('exportPdf')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex flex-col items-start max-w-3xl mx-auto">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1 px-1">
                  {t('engineLoading')}
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-700 flex items-center gap-3 shadow-sm">
                  <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-900 rounded-full animate-spin" />
                  <span className="font-semibold">
                    {t('engineLoadingMsg')}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Workspace */}
      <div className="border-t border-slate-200 bg-white p-4 shrink-0">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Dynamic Available Payer Tags */}
          {availablePayers.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pe-1 shrink-0">
                {t('payerTags')}
              </span>
              {availablePayers.map((payer) => {
                const tag = `@${payer}`;
                const isSelected = activePayerTag.toLowerCase() === tag.toLowerCase();
                return (
                  <button
                    key={payer}
                    type="button"
                    onClick={() => handleInsertTag(tag)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer shrink-0 border ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <span dir="ltr">{tag}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Attached File Preview */}
          {attachedFile && (
            <div className="p-2 bg-slate-50 border border-slate-200 rounded flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-700 truncate font-mono">
                <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate" dir="ltr">{attachedFile.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Attached Image Previews */}
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 bg-slate-50 border border-slate-200 rounded">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-14 h-14 object-cover rounded border border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="absolute -top-1.5 -end-1.5 p-0.5 bg-slate-900 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title={t('removeImage')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <span className="absolute bottom-0 inset-x-0 text-[9px] font-mono text-white bg-slate-900/70 px-1 truncate" dir="ltr">
                    {img.name}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Prompt Input Box */}
          <div className="relative border border-slate-300 rounded-lg focus-within:border-slate-900 focus-within:ring-1 focus-within:ring-slate-900 transition-all bg-white shadow-sm">
            <textarea
              rows={3}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t('chatPlaceholder')}
              className="w-full p-3 text-xs text-slate-900 placeholder-slate-400 resize-none focus:outline-none"
            />

            <div className="p-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".txt,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Attach clinical chart note or image"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t('attachEhrFile')}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={isLoading || (!inputPrompt.trim() && !attachedFile && attachedImages.length === 0)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isLoading || (!inputPrompt.trim() && !attachedFile && attachedImages.length === 0)
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-900 hover:bg-slate-800 text-white shadow-sm'
                }`}
              >
                <span>{t('verifyClaim')}</span>
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};