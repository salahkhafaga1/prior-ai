'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle,
  Database,
  X,
  Trash2,
  Upload,
  AlertCircle,
  RefreshCw,
  FileText,
  Copy,
  Check,
  Loader2,
  FileUp,
} from 'lucide-react';
import { PolicyDocument, isSupabaseConfigured } from '@/lib/supabase';

interface PolicySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPayerTag: (tag: string) => void;
  onPoliciesUpdated?: () => void;
}

export const PolicySidebar: React.FC<PolicySidebarProps> = ({
  isOpen,
  onClose,
  onSelectPayerTag,
  onPoliciesUpdated,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [payerName, setPayerName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');
  const [isPasteMode, setIsPasteMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [policies, setPolicies] = useState<PolicyDocument[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSupabaseLive = isSupabaseConfigured();

  const loadPolicies = async () => {
    setIsLoadingList(true);
    try {
      console.log('[SUPABASE LOG] Refreshing policy documents in sidebar...');
      const res = await fetch('/api/policy/list');
      const data = await res.json().catch(() => null);

      if (res.ok && data && data.success !== false && Array.isArray(data.policies)) {
        setPolicies(data.policies);
        setErrorMessage(null);
      } else {
        const message =
          data?.message || data?.error || 'Failed to fetch policies from database.';
        console.error('[SUPABASE LOG] Failed to fetch policies:', data);
        setPolicies([]);
        setErrorMessage(`[Database] ${message}`);
      }
    } catch (err) {
      console.error('[SUPABASE LOG] Exception fetching policies:', err);
      setPolicies([]);
      setErrorMessage('[Database] Network error while fetching policies.');
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPolicies();
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setErrorMessage(null);
    }
  };

  const handleCopyError = async () => {
    if (!errorMessage) return;
    try {
      await navigator.clipboard.writeText(errorMessage);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    } catch (err) {
      console.error('Failed to copy error:', err);
    }
  };

  const handleUploadPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!payerName.trim()) {
      setErrorMessage('[Validation Error] Payer Name is required (e.g. Aetna, Bupa, MetLife).');
      return;
    }

    if (!selectedFile && (!isPasteMode || !rawText.trim())) {
      setErrorMessage('[Validation Error] Please select a PDF or TXT policy document.');
      return;
    }

    setIsUploading(true);
    try {
      console.log(`[UPLOAD LOG] Uploading policy for payer "${payerName}"...`);
      const formData = new FormData();
      formData.append('payer', payerName.trim());

      if (selectedFile) {
        formData.append('file', selectedFile);
      } else if (rawText.trim()) {
        formData.append('content', rawText.trim());
      }

      const res = await fetch('/api/policy/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || data.success === false) {
        console.error('[UPLOAD LOG] Upload rejected:', data);
        setErrorMessage(data.error || data.message || `[Upload Error] Server returned HTTP ${res.status}`);
        return;
      }

      console.log('[UPLOAD LOG] Policy successfully saved:', data);
      setSuccessMessage(`Policy for "${payerName}" successfully stored into Supabase.`);
      setPayerName('');
      setSelectedFile(null);
      setRawText('');
      setIsAdding(false);
      if (fileInputRef.current) fileInputRef.current.value = '';

      await loadPolicies();
      onPoliciesUpdated?.();
    } catch (err: any) {
      console.error('[UPLOAD LOG] Network error during upload:', err);
      setErrorMessage(`[Network Error] ${err?.message || 'Failed to connect to upload server.'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePolicy = async (id?: string) => {
    if (!id) return;
    if (!confirm('Are you sure you want to remove this policy document from Supabase?')) return;

    try {
      console.log(`[SUPABASE LOG] Deleting policy ID: ${id}...`);
      const res = await fetch('/api/policy/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        setSuccessMessage('Policy document removed from database.');
        setTimeout(() => setSuccessMessage(null), 3000);
        await loadPolicies();
        onPoliciesUpdated?.();
      }
    } catch (err) {
      console.error('Error deleting policy:', err);
    }
  };

  const filteredPolicies = policies.filter(
    (p) =>
      p.payer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <aside className="w-80 lg:w-96 bg-white border-r border-slate-200 h-full flex flex-col shrink-0 z-40">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-slate-900 text-white rounded flex items-center justify-center font-bold text-xs">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Insurance Policy Library
            </h2>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Database className="w-3 h-3 text-emerald-600" />
              <span>{isSupabaseLive ? 'Live Supabase Store' : 'Database Ready'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadPolicies}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
            title="Refresh database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAdding(!isAdding);
              setErrorMessage(null);
            }}
            className="p-1.5 rounded bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            title="Upload Insurance Policy"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-3 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-900 flex items-center gap-2 font-medium">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Diagnostic Error Banner */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border-b-2 border-rose-300 text-xs text-rose-950 space-y-2">
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-1.5 text-rose-900">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Upload Notice</span>
            </div>
            <button
              type="button"
              onClick={handleCopyError}
              className="text-[10px] font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1"
            >
              {copiedError ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              <span>{copiedError ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <p className="font-mono text-[11px] leading-relaxed break-words">{errorMessage}</p>
        </div>
      )}

      {/* Simplified 2-Input Upload Form */}
      {isAdding && (
        <form onSubmit={handleUploadPolicy} className="p-4 bg-slate-50 border-b border-slate-200 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Upload Policy Document
            </span>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-[11px] text-slate-400 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          {/* INPUT 1: Payer Name */}
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
              1. Payer Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Aetna, Bupa, MetLife, UnitedHealthcare"
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-xs text-slate-900 placeholder-slate-400 focus:border-slate-900 font-medium"
            />
          </div>

          {/* INPUT 2: File Upload (PDF / TXT up to 50MB) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold uppercase text-slate-600">
                2. Policy Document (PDF or TXT) *
              </label>
              <button
                type="button"
                onClick={() => setIsPasteMode(!isPasteMode)}
                className="text-[10px] font-bold text-sky-600 hover:text-sky-800"
              >
                {isPasteMode ? 'Upload File instead' : 'Paste Text instead'}
              </button>
            </div>

            {isPasteMode ? (
              <textarea
                rows={4}
                required
                placeholder="Paste insurance policy criteria text..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded text-xs font-mono text-slate-900 placeholder-slate-400 resize-none focus:border-slate-900"
              />
            ) : (
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".pdf,.txt,.doc,.docx"
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-4 border-2 border-dashed rounded text-center cursor-pointer transition-colors bg-white ${
                    selectedFile
                      ? 'border-slate-900 bg-slate-50/50'
                      : 'border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-900">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                      <span className="text-[10px] text-slate-400">
                        ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <FileUp className="w-6 h-6 mx-auto text-slate-400" />
                      <div className="text-xs font-bold text-slate-700">
                        Click to select PDF or TXT file
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Supported formats: PDF, TXT (Up to 50MB)
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Upload Button */}
          <button
            type="submit"
            disabled={isUploading}
            className={`w-full py-2.5 px-4 rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              isUploading
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-slate-900 hover:bg-slate-800 text-white shadow-sm'
            }`}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Extracting & Saving Policy (Up to 50MB)...</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                <span>Upload to Database</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* Search Input */}
      <div className="p-3 border-b border-slate-200">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search uploaded policies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 placeholder-slate-400 focus:bg-white"
          />
        </div>
      </div>

      {/* Policy List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {policies.length === 0 ? (
          <div className="text-center py-10 px-4 text-slate-400 space-y-2">
            <FileText className="w-8 h-8 mx-auto stroke-1" />
            <p className="text-xs font-semibold text-slate-600">No Policy Documents Yet</p>
            <p className="text-[11px] leading-relaxed">
              Click the <span className="font-bold text-slate-700">+</span> button above to upload a policy PDF or TXT document (Up to 50MB).
            </p>
          </div>
        ) : (
          filteredPolicies.map((p) => (
            <div
              key={p.id || p.title}
              className="p-3 border border-slate-200 rounded hover:border-slate-300 bg-white space-y-1.5 transition-all text-left group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-slate-100 text-slate-900 rounded border border-slate-200">
                  {p.payer}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectPayerTag(`@${p.payer}`)}
                    className="text-[10px] font-bold text-slate-900 hover:text-sky-600 cursor-pointer"
                  >
                    Tag @{p.payer}
                  </button>
                  {p.id && (
                    <button
                      type="button"
                      onClick={() => handleDeletePolicy(p.id)}
                      className="text-slate-300 hover:text-rose-600 transition-colors p-0.5"
                      title="Delete from database"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs font-bold text-slate-900 leading-tight">
                {p.title}
              </div>

              <div className="text-[11px] text-slate-600 font-serif line-clamp-3 bg-slate-50 p-2 rounded border border-slate-100">
                {p.content}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
