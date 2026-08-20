export type Language = 'en' | 'ar';

const en = {
  // Language switch
  langSwitch: 'English | العربية',

  // ChatWorkspace top bar
  appTitle: 'PriorAuth Copilot',
  prodRagTag: '/ Production RAG',
  openPolicyLibrary: 'Insurance Policy Library',

  // Empty state
  emptyTitle: 'Production Medical Prior Authorization Workspace',
  emptyDescription:
    'Paste patient encounter records and mention a target payer with @PayerName to evaluate medical necessity against real policy documents.',
  noPoliciesTitle: 'No Insurance Policies Uploaded Yet',
  noPoliciesDesc:
    'To perform zero-hallucination policy evaluations, please click below to upload your first insurance policy document into the database.',
  uploadPolicyBtn: 'Upload Insurance Policy PDF',
  activePayersTitle: 'Active Database Grounded Payers:',
  payersHint: 'Click a payer tag above or type your clinical prompt with @PayerName to begin.',

  // Message headers / roles
  physician: 'Physician',
  engine: 'PriorAuth Verification Engine',

  // User bubble
  attachedRecord: 'Attached Record:',
  uploadedImages: 'Uploaded image(s):',
  uploadedChart: 'Uploaded chart record:',

  // Loading
  engineLoading: 'PriorAuth Engine',
  engineLoadingMsg: 'Querying Supabase Policy Documents & Evaluating Grounded Criteria...',

  // Errors / diagnostics
  copyLog: 'Copy Error Log',
  logCopied: 'Log Copied!',
  showTechDetails: 'Show Technical Details',
  hideTechDetails: 'Hide Technical Details',
  openPolicyLibraryShort: 'Open Insurance Policy Library',

  // Result card
  coverageApproved: 'Coverage Approved ({n}% Match)',
  actionRequired: 'Action Required ({n}% Criteria Met)',
  documentationGaps: 'Documentation Gaps to Resolve:',
  criteriaCitations: 'Policy Criteria Verification & Citations:',
  clause: 'Clause:',
  satisfied: 'Satisfied',
  missing: 'Missing',
  chartEvidence: 'Chart Evidence:',
  attachedImageProcessing: 'Attached Image Processing',
  ocrText: 'OCR Text ({n} chars)',
  imageUnderstanding: 'Image Understanding',
  ocrFailed: 'OCR',
  imageUnderstandingFailed: 'Image Understanding',
  failed: 'failed:',
  viewOfficialPacket: 'View Official Packet',
  exportPdf: 'Export PDF',

  // Input workspace
  payerTags: 'Payer Tags:',
  attachEhrFile: 'Attach EHR File / Image',
  chatPlaceholder:
    'Enter patient clinical chart, exam findings, prior conservative treatments, and @PayerName...',
  verifyClaim: 'Verify Claim',
  removeImage: 'Remove',

  // Translation of server error codes (kept in the UI language)
  errNoPayerMatch:
    'No policy document found for the selected payer in the database. Please open the Insurance Policy Library and upload the official policy PDF.',
  errNoPayersInDb:
    'No insurance policy documents found in the database. Please open the Insurance Policy Library and upload a policy PDF.',
  errPayloadTooLarge:
    'Request payload is too large for the hosting platform limit. Attach fewer or smaller images and try again.',
  errEmptyPrompt:
    'Clinical prompt or EHR chart note is required. Please enter patient clinical notes or attach a chart record file before submitting.',
  errDefault: 'The evaluation request could not be completed. Please review the technical details below and try again.',

  // PolicySidebar
  sidebarTitle: 'Insurance Policy Library',
  liveStore: 'Live Supabase Store',
  databaseReady: 'Database Ready',
  refreshDb: 'Refresh database',
  uploadPolicy: 'Upload Insurance Policy',
  uploadNotice: 'Upload Notice',
  copyLabel: 'Copy',
  copiedLabel: 'Copied',
  uploadPolicyTitle: 'Upload Policy Document',
  cancel: 'Cancel',
  payerNameLabel: '1. Payer Name *',
  payerNamePlaceholder: 'e.g. Aetna, Bupa, MetLife, UnitedHealthcare',
  policyDocLabel: '2. Policy Document (PDF or TXT) *',
  pasteText: 'Paste Text instead',
  uploadFileInstead: 'Upload File instead',
  pastePolicyText: 'Paste insurance policy criteria text...',
  clickSelect: 'Click to select PDF or TXT file',
  supportedFormats: 'Supported formats: PDF, TXT (Up to 50MB)',
  extractingSaving: 'Extracting & Saving Policy (Up to 50MB)...',
  uploadToDatabase: 'Upload to Database',
  searchPlaceholder: 'Search uploaded policies...',
  noPoliciesYet: 'No Policy Documents Yet',
  noPoliciesHint:
    'Click the + button above to upload a policy PDF or TXT document (Up to 50MB).',
  tagAction: 'Tag',
  deleteTitle: 'Delete from database',
  deleteConfirm: 'Are you sure you want to remove this policy document from Supabase?',
  uploadValidationPayer: 'Payer Name is required (e.g. Aetna, Bupa, MetLife).',
  uploadValidationDoc: 'Please select a PDF or TXT policy document.',
  uploadSuccess: 'Policy for "{payer}" successfully stored into Supabase.',
  deletedSuccess: 'Policy document removed from database.',
  networkError: 'Failed to connect to upload server.',

  // PriorAuthReportView
  packetTitle: 'Official Prior Authorization & Medical Necessity Packet',
  copyText: 'Copy Text',
  closeButton: 'Close',
  medicalNecessityTitle: 'Medical Necessity & Prior Authorization Determination',
  targetPayer: 'Target Payer:',
  date: 'Date:',
  docRef: 'Doc Ref:',
  determinationApproved: 'Determination: Criteria Approved ({n}% Match)',
  determinationAction: 'Determination: Action Required ({n}% Criteria Met)',
  evaluatedStrictly: 'Evaluated strictly against uploaded policy document guidelines.',
  outstandingRequirements: 'Outstanding Policy Requirements to Resolve:',
  itemizedCriteria: 'Itemized Policy Criteria, Exact Citations & Chart Findings',
  policyRequirement: 'Policy Requirement',
  status: 'Status',
  policyCitationQuote: 'Policy Citation & Exact Quote',
  clinicalChartEvidence: 'Clinical Chart Evidence',
  attendingStatement: 'Attending Physician Medical Necessity Statement',
  signatureLabel: 'Attending Physician Reviewer',
  npiLicense: 'NPI / License: Verified Clinical Staff',
  physicianSignatureDate: 'Physician Signature & Date',
} as const;

export type TranslationKey = keyof typeof en;

const ar: Record<TranslationKey, string> = {
  langSwitch: 'English | العربية',

  appTitle: 'مساعد الموافقات المسبقة',
  prodRagTag: '/ نظام RAG الإنتاجي',
  openPolicyLibrary: 'مكتبة سياسات التأمين',

  emptyTitle: 'مساحة عمل الموافقات الطبية المسبقة الإنتاجية',
  emptyDescription:
    'الصق سجل المريض واذكر شركة التأمين المستهدفة بصيغة @اسم_الشركة لتقييم الضرورة الطبية وفق مستندات السياسة الفعلية.',
  noPoliciesTitle: 'لم يتم رفع أي سياسات تأمين بعد',
  noPoliciesDesc:
    'لإجراء تقييمات سياسة بدون تخمين، يرجى الضغط أدناه لرفع أول مستند سياسة تأمين إلى قاعدة البيانات.',
  uploadPolicyBtn: 'رفع ملف سياسة تأمين PDF',
  activePayersTitle: 'شركات التأمين النشطة المرتكزة على قاعدة البيانات:',
  payersHint: 'اضغط على إحدى شركات التأمين أعلاه أو اكتب استفسارك الطبي مع @اسم_الشركة للبدء.',

  physician: 'الطبيب',
  engine: 'محرك التحقق من الموافقة المسبقة',

  attachedRecord: 'السجل المرفق:',
  uploadedImages: 'الصور المرفوعة:',
  uploadedChart: 'السجل المرفوع:',

  engineLoading: 'محرك الموافقة المسبقة',
  engineLoadingMsg: 'جارٍ الاستعلام عن مستندات السياسة وتقييم المعايير المرتكزة...',

  copyLog: 'نسخ سجل الخطأ',
  logCopied: 'تم نسخ السجل!',
  showTechDetails: 'إظهار التفاصيل التقنية',
  hideTechDetails: 'إخفاء التفاصيل التقنية',
  openPolicyLibraryShort: 'فتح مكتبة سياسات التأمين',

  coverageApproved: 'تمت الموافقة على التغطية ({n}% تطابق)',
  actionRequired: 'مطلوب إجراء ({n}% من المعايير محققة)',
  documentationGaps: 'فجوات التوثيق المطلوب معالجتها:',
  criteriaCitations: 'التحقق من معايير السياسة والاقتباسات:',
  clause: 'البنـد:',
  satisfied: 'محقق',
  missing: 'ناقص',
  chartEvidence: 'الدليل من السجل:',
  attachedImageProcessing: 'معالجة الصور المرفقة',
  ocrText: 'نص OCR ({n} حرفًا)',
  imageUnderstanding: 'فهم الصورة',
  ocrFailed: 'OCR',
  imageUnderstandingFailed: 'فهم الصورة',
  failed: 'فشل:',
  viewOfficialPacket: 'عرض الملف الرسمي',
  exportPdf: 'تصدير PDF',

  payerTags: 'شركات التأمين:',
  attachEhrFile: 'إرفاق ملف / صورة',
  chatPlaceholder:
    'أدخل السجل الطبي للمريض ونتائج الفحص والعلاجات المحافظة السابقة و@اسم_شركة_التأمين...',
  verifyClaim: 'تحقق من المطالبة',
  removeImage: 'إزالة',

  errNoPayerMatch:
    'لم يتم العثور على مستند سياسة لشركة التأمين المحددة في قاعدة البيانات. يرجى فتح مكتبة سياسات التأمين ورفع ملف السياسة الرسمي.',
  errNoPayersInDb:
    'لا توجد مستندات سياسات تأمين في قاعدة البيانات. يرجى فتح مكتبة سياسات التأمين ورفع ملف سياسة.',
  errPayloadTooLarge:
    'حجم الطلب أكبر من الحد المسموح به لمنصة الاستضافة. قم بإرفاق صور أقل أو أصغر وحاول مجددًا.',
  errEmptyPrompt:
    'السجل الطبي مطلوب. يرجى إدخال ملاحظات المريض السريرية أو إرفاق سجل قبل الإرسال.',
  errDefault: 'تعذر إكمال طلب التقييم. يرجى مراجعة التفاصيل التقنية أدناه والمحاولة مجددًا.',

  sidebarTitle: 'مكتبة سياسات التأمين',
  liveStore: 'مخزن Supabase مباشر',
  databaseReady: 'قاعدة البيانات جاهزة',
  refreshDb: 'تحديث قاعدة البيانات',
  uploadPolicy: 'رفع سياسة تأمين',
  uploadNotice: 'إشعار الرفع',
  copyLabel: 'نسخ',
  copiedLabel: 'تم النسخ',
  uploadPolicyTitle: 'رفع مستند السياسة',
  cancel: 'إلغاء',
  payerNameLabel: '1. اسم شركة التأمين *',
  payerNamePlaceholder: 'مثال: Aetna, Bupa, MetLife, UnitedHealthcare',
  policyDocLabel: '2. مستند السياسة (PDF أو TXT) *',
  pasteText: 'لصق النص بدلًا من ذلك',
  uploadFileInstead: 'رفع ملف بدلًا من ذلك',
  pastePolicyText: 'الصق نص معايير سياسة التأمين...',
  clickSelect: 'اضغط لاختيار ملف PDF أو TXT',
  supportedFormats: 'الصيغ المدعومة: PDF, TXT (حتى 50MB)',
  extractingSaving: 'جارٍ استخراج وحفظ السياسة (حتى 50MB)...',
  uploadToDatabase: 'رفع إلى قاعدة البيانات',
  searchPlaceholder: 'ابحث في السياسات المرفوعة...',
  noPoliciesYet: 'لا توجد مستندات سياسات بعد',
  noPoliciesHint: 'اضغط على زر + بالأعلى لرفع مستند سياسة PDF أو TXT (حتى 50MB).',
  tagAction: 'وسم',
  deleteTitle: 'حذف من قاعدة البيانات',
  deleteConfirm: 'هل أنت متأكد من حذف مستند السياسة من Supabase؟',
  uploadValidationPayer: 'اسم شركة التأمين مطلوب (مثال: Aetna, Bupa, MetLife).',
  uploadValidationDoc: 'يرجى اختيار مستند سياسة PDF أو TXT.',
  uploadSuccess: 'تم حفظ سياسة "{payer}" بنجاح في Supabase.',
  deletedSuccess: 'تم حذف مستند السياسة من قاعدة البيانات.',
  networkError: 'تعذر الاتصال بخادم الرفع.',

  packetTitle: 'ملف الموافقة المسبقة والضرورة الطبية الرسمي',
  copyText: 'نسخ النص',
  closeButton: 'إغلاق',
  medicalNecessityTitle: 'تحديد الضرورة الطبية والموافقة المسبقة',
  targetPayer: 'شركة التأمين المستهدفة:',
  date: 'التاريخ:',
  docRef: 'المرجع:',
  determinationApproved: 'القرار: تمت الموافقة على المعايير ({n}% تطابق)',
  determinationAction: 'القرار: مطلوب إجراء ({n}% من المعايير محققة)',
  evaluatedStrictly: 'تم التقييم بدقة وفقًا لإرشادات مستند السياسة المرفوع.',
  outstandingRequirements: 'متطلبات السياسة المعلقة الواجب معالجتها:',
  itemizedCriteria: 'معايير السياسة المفصلة والاقتباسات ونتائج السجل',
  policyRequirement: 'متطلب السياسة',
  status: 'الحالة',
  policyCitationQuote: 'اقتباس السياسة والنص الحرفي',
  clinicalChartEvidence: 'الدليل من السجل الطبي',
  attendingStatement: 'بيان الضرورة الطبية للطبيب المعالج',
  signatureLabel: 'الطبيب المعالج المراجع',
  npiLicense: 'NPI / الترخيص: طاقم سريري موثّق',
  physicianSignatureDate: 'توقيع الطبيب والتاريخ',
};

export const translations: Record<Language, Record<TranslationKey, string>> = { en, ar };

export function formatString(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}