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
} from 'lucide-react';
import { PriorAuthReportData } from '@/components/PriorAuthReportView';
import { ProcessedImageAttachment, ImageAttachmentRequest } from '@/types/imageProcessing';

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
        const data = await res.json();
        const payers = (data.payers as string[]) || [];
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
          ? `Uploaded image(s): ${attachedImages.map((i) => i.name).join(', ')}`
          : `Uploaded chart record: ${attachedFile?.name}`),
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessageText,
          payer: activePayerTag.replace('@', ''),
          images: imagesPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.success === false || data.error) {
        console.error('[RAG ENGINE LOG] API returned error:', data);
        const errorInfo: DiagnosticErrorInfo = {
          source: data.source || '[RAG Pipeline]',
          errorCode: data.errorCode || `HTTP_${res.status}`,
          message: data.message || data.error || 'Evaluation failed.',
          details: data.details || `Status code ${res.status}`,
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
      const summaryText = data.summary || data.summaryMessage || 'Prior Authorization analysis complete.';

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
        message: 'Failed to connect to Prior Authorization API route.',
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
              PriorAuth Copilot <span className="text-slate-400 font-normal">/ Production RAG</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenPolicyLibrary}
            className="px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Insurance Policy Library</span>
            {availablePayers.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-slate-900 text-white rounded-full text-[10px]">
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
                Production Medical Prior Authorization Workspace
              </h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Paste patient encounter records and mention a target payer with <span className="font-bold text-slate-700">@PayerName</span> to evaluate medical necessity against real policy documents.
              </p>
            </div>

            {availablePayers.length === 0 ? (
              /* No Policies Warning Banner */
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-left max-w-md mx-auto space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>No Insurance Policies Uploaded Yet</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  To perform zero-hallucination policy evaluations, please click below to upload your first insurance policy document into the database.
                </p>
                <button
                  type="button"
                  onClick={onOpenPolicyLibrary}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Upload Insurance Policy PDF</span>
                </button>
              </div>
            ) : (
              /* Instructions with Available Payers */
              <div className="p-4 bg-white border border-slate-200 rounded-lg text-left max-w-md mx-auto space-y-2 shadow-sm">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Active Database Grounded Payers:
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {availablePayers.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleInsertTag(`@${p}`)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 rounded text-xs font-semibold cursor-pointer"
                    >
                      @{p}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 pt-1">
                  Click a payer tag above or type your clinical prompt with @PayerName to begin.
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
                  {m.role === 'user' ? 'Physician' : 'PriorAuth Verification Engine'} • {m.timestamp}
                </div>

                {/* Message Card */}
                {m.role === 'user' ? (
                  <div className="bg-slate-900 text-white rounded-lg p-4 text-xs font-mono max-w-2xl leading-relaxed whitespace-pre-wrap shadow-sm">
                    {m.content}
                    {m.attachmentName && (
                      <div className="mt-2 pt-2 border-t border-slate-700 text-[11px] text-slate-300 flex items-center gap-1.5">
                        <Paperclip className="w-3 h-3" />
                        <span>Attached Record: {m.attachmentName}</span>
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
                          {m.errorInfo.source}
                        </span>
                        <span className="font-mono font-extrabold text-[11px] text-rose-700">
                          {m.errorInfo.errorCode}
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
                            <span>Log Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Error Log</span>
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
                          <span>{expandedDetails[m.id] ? 'Hide Technical Details' : 'Show Technical Details'}</span>
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
                          <span>Open Insurance Policy Library</span>
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
                              ? `Coverage Approved (${m.reportData.matchScore}% Match)`
                              : `Action Required (${m.reportData.matchScore}% Criteria Met)`}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] bg-black/10 px-2 py-0.5 rounded font-bold">
                          {m.reportData.payer}
                        </span>
                      </div>
                    )}

                    {/* Summary Message */}
                    <div className="leading-relaxed text-slate-700 font-medium">
                      {m.content}
                    </div>

                    {/* Missing Requirements Box */}
                    {m.reportData?.missingRequirements && m.reportData.missingRequirements.length > 0 && (
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded text-amber-900 space-y-1">
                        <div className="font-bold text-[11px] uppercase">
                          Documentation Gaps to Resolve:
                        </div>
                        <ul className="list-disc list-inside text-xs space-y-0.5">
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
                          Policy Criteria Verification & Citations:
                        </div>
                        <div className="space-y-2">
                          {m.reportData.checklist.map((c, i) => (
                            <div
                              key={i}
                              className="p-3 rounded bg-slate-50 border border-slate-200 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-900">
                                  {c.requirement}
                                </span>
                                <span
                                  className={`font-bold uppercase px-2 py-0.5 rounded text-[10px] shrink-0 ${
                                    c.met
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-900'
                                  }`}
                                >
                                  {c.met ? 'Satisfied' : 'Missing'}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-100 space-y-1">
                                <div className="font-semibold text-slate-700">
                                  Clause: <span className="font-mono text-slate-900">{c.sectionClause}</span>
                                </div>
                                <div className="italic font-serif text-slate-600">
                                  &ldquo;{c.exactPolicyQuote}&rdquo;
                                </div>
                              </div>

                              <div className="text-[11px] text-slate-700 pl-1 font-mono">
                                <span className="font-bold text-slate-500">Chart Evidence:</span> {c.patientEvidence}
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
                          Attached Image Processing
                        </div>
                        {m.attachments.map((att, i) => (
                          <div
                            key={i}
                            className="p-3 rounded bg-slate-50 border border-slate-200 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 truncate">{att.fileName}</span>
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
                                  OCR Text ({att.ocrText.length} chars)
                                </summary>
                                <pre className="mt-1 p-2 bg-white border border-slate-100 rounded font-mono text-slate-700 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                                  {att.ocrText}
                                </pre>
                              </details>
                            )}

                            {att.imageDescription && (
                              <details className="text-[11px]" open={att.ocrText ? false : true}>
                                <summary className="font-bold text-slate-700 cursor-pointer">
                                  Image Understanding
                                </summary>
                                <div className="mt-1 p-2 bg-white border border-slate-100 rounded text-slate-600 leading-relaxed">
                                  {att.imageDescription}
                                </div>
                              </details>
                            )}

                            {att.error && (
                              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-1.5">
                                {att.error.phase === 'ocr' ? 'OCR' : 'Image Understanding'} failed:{' '}
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
                          <span>View Official Packet</span>
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
                          <span>Export PDF</span>
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
                  PriorAuth Engine
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-700 flex items-center gap-3 shadow-sm">
                  <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-900 rounded-full animate-spin" />
                  <span className="font-semibold">
                    Querying Supabase Policy Documents & Evaluating Grounded Criteria...
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pr-1 shrink-0">
                Payer Tags:
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
                    {tag}
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
                <span className="truncate">{attachedFile.name}</span>
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
                    className="absolute -top-1.5 -right-1.5 p-0.5 bg-slate-900 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title={`Remove ${img.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <span className="absolute bottom-0 left-0 right-0 text-[9px] font-mono text-white bg-slate-900/70 px-1 truncate">
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
              placeholder="Enter patient clinical chart, exam findings, prior conservative treatments, and @PayerName..."
              className="w-full p-3 text-xs text-slate-900 placeholder-slate-400 font-mono resize-none focus:outline-none"
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
                  <span className="hidden sm:inline">Attach EHR File / Image</span>
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
                <span>Verify Claim</span>
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
