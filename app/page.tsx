'use client';

import React, { useState } from 'react';
import { ChatWorkspace } from '@/components/ChatWorkspace';
import { PolicySidebar } from '@/components/PolicySidebar';
import { PriorAuthReportView, PriorAuthReportData } from '@/components/PriorAuthReportView';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

export default function Home() {
  const [isPolicySidebarOpen, setIsPolicySidebarOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<PriorAuthReportData | null>(null);
  const [activePayerTag, setActivePayerTag] = useState('');
  const [payersRefreshKey, setPayersRefreshKey] = useState(0);

  const handlePoliciesUpdated = () => {
    setPayersRefreshKey((prev) => prev + 1);
  };

  return (
    <LanguageProvider>
      <div className="h-screen w-full flex overflow-hidden bg-[#FAFBFC]">
        {/* Dynamic Insurance Policy Library Sidebar */}
        <PolicySidebar
          isOpen={isPolicySidebarOpen}
          onClose={() => setIsPolicySidebarOpen(false)}
          onSelectPayerTag={(tag) => {
            setActivePayerTag(tag);
            setIsPolicySidebarOpen(false);
          }}
          onPoliciesUpdated={handlePoliciesUpdated}
        />

        {/* Main Production Chat Workspace */}
        <ChatWorkspace
          onOpenPolicyLibrary={() => setIsPolicySidebarOpen(!isPolicySidebarOpen)}
          onViewReport={(report) => setActiveReport(report)}
          activePayerTag={activePayerTag}
          setActivePayerTag={setActivePayerTag}
          payersRefreshKey={payersRefreshKey}
        />

        {/* Official PDF Report View / Print Modal */}
        {activeReport && (
          <PriorAuthReportView
            report={activeReport}
            onClose={() => setActiveReport(null)}
          />
        )}
      </div>
    </LanguageProvider>
  );
}
