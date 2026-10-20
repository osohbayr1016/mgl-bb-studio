export type WorkbenchLane =
  | 'surface'
  | 'frontend'
  | 'backend'
  | 'data'
  | 'integration'
  | 'ai'
  | 'revit';

export type WorkbenchNode = {
  id: string;
  label: string;
  subtitle: string;
  lane: WorkbenchLane;
  order: number;
  kind: 'actor' | 'app' | 'service' | 'domain' | 'store' | 'integration' | 'runtime';
  sourcePaths: string[];
  description: string;
};

export type WorkbenchEdge = {
  from: string;
  to: string;
  type: 'http' | 'data' | 'event' | 'sync' | 'local' | 'ai' | 'render';
  label?: string;
};

export const LANE_LABELS: Record<WorkbenchLane, string> = {
  surface: 'Users / Surfaces',
  frontend: 'React Frontend',
  backend: 'Cloudflare Control Plane',
  data: 'Data / Stateful',
  integration: 'External Integrations',
  ai: 'MGL AI / MCP',
  revit: 'Revit / Desktop',
};

export const WORKBENCH_NODES: WorkbenchNode[] = [
  { id:'staff', label:'Staff', subtitle:'admin · senior · architect · engineer', lane:'surface', order:0, kind:'actor', sourcePaths:['backend/src/types.ts','frontend/src/shared/components/ProtectedRoute.tsx'], description:'Internal staff personas entering the operational ERP.' },
  { id:'client-user', label:'Client', subtitle:'client persona', lane:'surface', order:1, kind:'actor', sourcePaths:['backend/src/lib/clientScope.ts','frontend/src/features/client/ClientDashboardPage.tsx'], description:'External project client using the sandboxed client portal.' },
  { id:'claude', label:'Claude', subtitle:'Desktop / Code / remote MCP', lane:'surface', order:2, kind:'actor', sourcePaths:['backend/src/mcp/MglMcpAgent.ts','revit-mcp/README.md'], description:'AI client that can use the remote ERP MCP and the local live-Revit bridge.' },
  { id:'browser', label:'ERP SPA', subtitle:'React 19 + Vite', lane:'frontend', order:0, kind:'app', sourcePaths:['frontend/src/app/main.tsx','frontend/src/app/routes.tsx'], description:'Main staff, public, print and client web surfaces.' },
  { id:'auth-ui', label:'Auth Context', subtitle:'session + role + brand', lane:'frontend', order:1, kind:'service', sourcePaths:['frontend/src/shared/context/AuthContext.tsx','frontend/src/shared/components/ProtectedRoute.tsx'], description:'Resolves user session, handles role sandboxing, network failure and token resync.' },
  { id:'query', label:'TanStack Query', subtitle:'cache + refetch', lane:'frontend', order:2, kind:'service', sourcePaths:['frontend/src/shared/api/queryClient.ts'], description:'Shared server-state cache and retry policy.' },
  { id:'api-client', label:'API Client', subtitle:'timeout · retry · upload', lane:'frontend', order:3, kind:'service', sourcePaths:['frontend/src/shared/api/client.ts','frontend/src/shared/api/apiHost.ts'], description:'Central browser transport with auth, device identity, mutation safety and multipart uploads.' },
  { id:'worker', label:'Hono Worker', subtitle:'mgl-progress-api', lane:'backend', order:0, kind:'service', sourcePaths:['backend/src/index.ts','backend/wrangler.toml'], description:'The modular-monolith application server and Cloudflare composition root.' },
  { id:'security', label:'Security Gates', subtitle:'auth · office · scope · entitlement', lane:'backend', order:1, kind:'service', sourcePaths:['backend/src/middleware/auth.ts','backend/src/middleware/officeAccessGuard.ts','backend/src/lib/workerScope.ts','backend/src/lib/clientScope.ts','backend/src/lib/entitlement.ts'], description:'Cross-cutting authorization gates applied before domain routers.' },
  { id:'projects', label:'Projects', subtitle:'aggregate root', lane:'backend', order:2, kind:'domain', sourcePaths:['backend/src/routes/projects.ts','frontend/src/features/projects/ProjectDetailPage.tsx'], description:'Project metadata, members, passport, team reports, models and project-wide activity.' },
  { id:'tasks', label:'Tasks', subtitle:'WBS + checklist + take', lane:'backend', order:3, kind:'domain', sourcePaths:['backend/src/routes/tasks.ts','frontend/src/features/tasks/MyTasksPage.tsx'], description:'Tasks under the block → drawing → component work breakdown structure.' },
  { id:'allocation', label:'Task Allocation', subtitle:'split · contributors · audit', lane:'backend', order:4, kind:'domain', sourcePaths:['backend/src/routes/taskAllocations.ts','backend/src/routes/taskAllocAdmin.ts','frontend/src/features/task-allocation/TaskAllocationAdminPage.tsx'], description:'Managed ownership, split/retake/release and allocation audit contracts.' },
  { id:'progress', label:'Progress', subtitle:'submissions + scoring', lane:'backend', order:5, kind:'domain', sourcePaths:['backend/src/routes/progress.ts','backend/src/lib/progressLatest.ts'], description:'Progress submissions, latest-state calculation, completion summaries and productivity effects.' },
  { id:'attendance', label:'Attendance', subtitle:'device + shift + leave', lane:'backend', order:6, kind:'domain', sourcePaths:['backend/src/routes/attendance.ts','frontend/src/features/attendance/AttendanceRoute.tsx'], description:'Clock sessions, device binding, office network, shifts, checkpoints and timesheets.' },
  { id:'documents', label:'Documents', subtitle:'archive + revisions', lane:'backend', order:7, kind:'domain', sourcePaths:['backend/src/routes/documents.ts','backend/src/routes/documentArchiveRoutes.ts','frontend/src/features/projects/DocumentsPage.tsx'], description:'Document metadata, revision workflow and internal archive surfaces.' },
  { id:'drive', label:'Project Drive', subtitle:'Google Drive as source', lane:'backend', order:8, kind:'domain', sourcePaths:['backend/src/routes/projectDrive.ts','backend/src/lib/projectDriveSync.ts','frontend/src/features/projects/drive/ProjectDriveDocumentsPage.tsx'], description:'Project Google Drive browsing, versions, uploads, restore and change ledger.' },
  { id:'signing', label:'Signing', subtitle:'internal + public', lane:'backend', order:9, kind:'domain', sourcePaths:['backend/src/routes/driveSigning.ts','backend/src/routes/publicDocumentSigning.ts','backend/src/routes/correspondenceSignature.ts'], description:'Profile signatures, director approval and expiring external signature links.' },
  { id:'asr', label:'Author Supervision', subtitle:'site inspection / ASR', lane:'backend', order:10, kind:'domain', sourcePaths:['backend/src/routes/authorSupervision.ts','frontend/src/features/asr/AsrPage.tsx'], description:'Field inspection reports, red book, recordings, visits and PDF reports.' },
  { id:'client', label:'Client Platform', subtitle:'portal + deliverables', lane:'backend', order:11, kind:'domain', sourcePaths:['backend/src/routes/clientPortal.ts','backend/src/routes/clientAdmin.ts','backend/src/routes/clientDrive.ts'], description:'Client organizations, project access, submissions, deliverables, publications and Drive sharing.' },
  { id:'qto', label:'QTO / BOQ', subtitle:'quantities + Revit runs', lane:'backend', order:12, kind:'domain', sourcePaths:['backend/src/routes/qto.ts','frontend/src/features/qto/QtoPage.tsx'], description:'Quantity take-off history, schedules, view exports and project dashboards.' },
  { id:'reports', label:'Reports', subtitle:'project + employee + PDF', lane:'backend', order:13, kind:'domain', sourcePaths:['backend/src/routes/reports.ts','backend/src/routes/performanceReports.ts'], description:'Employee/project reporting, snapshots, performance reports and exports.' },
  { id:'email', label:'Email', subtitle:'Gmail + correspondence', lane:'backend', order:14, kind:'domain', sourcePaths:['backend/src/routes/email.ts','backend/src/lib/emailSync.ts','frontend/src/features/email/MailInboxPage.tsx'], description:'Mailbox sync, triage, attachments, correspondence and sending.' },
  { id:'meetings', label:'Meetings', subtitle:'audio → transcript → action', lane:'backend', order:15, kind:'domain', sourcePaths:['backend/src/routes/meetings.ts','backend/src/lib/meetingTranscription.ts'], description:'Private audio, Speechmatics transcript, analysis, tasks and minutes.' },
  { id:'quotes', label:'Quotes', subtitle:'pricing + templates', lane:'backend', order:16, kind:'domain', sourcePaths:['backend/src/routes/quotes.ts','frontend/src/features/quotes/QuotesPage.tsx'], description:'Price quotes, tariffs, templates, scope, translations and PDFs.' },
  { id:'compliance', label:'Compliance', subtitle:'rules + findings', lane:'backend', order:17, kind:'domain', sourcePaths:['backend/src/routes/compliance.ts','backend/src/lib/complianceAuthority.ts'], description:'Norm documents, rule packs, findings, overrides and project readiness.' },
  { id:'notifications', label:'Notifications', subtitle:'bell + push queue', lane:'backend', order:18, kind:'domain', sourcePaths:['backend/src/routes/notifications.ts','backend/src/routes/push.ts','backend/src/lib/pushSweep.ts'], description:'Cross-domain notification ledger, user preferences and Web Push delivery.' },
  { id:'d1', label:'D1', subtitle:'relational source of truth', lane:'data', order:0, kind:'store', sourcePaths:['backend/migrations/0001_init.sql','backend/src/types.ts'], description:'Primary relational state across ERP domains and AI control-plane metadata.' },
  { id:'r2-media', label:'R2 Media', subtitle:'public/general media', lane:'data', order:1, kind:'store', sourcePaths:['backend/src/routes/media.ts','backend/src/routes/upload.ts'], description:'General uploaded media plus migration fallback behavior.' },
  { id:'r2-audio', label:'R2 Meeting Audio', subtitle:'private object store', lane:'data', order:2, kind:'store', sourcePaths:['backend/src/routes/meetingAudio.ts','backend/src/routes/upload.ts'], description:'Private meeting recordings streamed only through signed routes.' },
  { id:'oauth-kv', label:'OAuth KV', subtitle:'MCP grants + tokens', lane:'data', order:3, kind:'store', sourcePaths:['backend/wrangler.toml','backend/src/oauth/authorize.ts'], description:'OAuth grants, clients and access/refresh tokens for remote MCP.' },
  { id:'mcp-do', label:'MCP Durable Object', subtitle:'session state', lane:'data', order:4, kind:'store', sourcePaths:['backend/src/mcp/MglMcpAgent.ts','backend/wrangler.toml'], description:'SQLite-backed MCP agent session container.' },
  { id:'client-do', label:'ClientRoom DO', subtitle:'realtime transport', lane:'data', order:5, kind:'store', sourcePaths:['backend/src/lib/clientEvents.ts','backend/wrangler.toml'], description:'Project-scoped WebSocket transport; D1 client_events remains canonical truth.' },
  { id:'browser-render', label:'Browser Rendering', subtitle:'server PDF', lane:'integration', order:0, kind:'integration', sourcePaths:['backend/src/lib/browser.ts','backend/wrangler.toml'], description:'Headless Chromium loads isolated React print routes and emits PDFs.' },
  { id:'google', label:'Google Workspace', subtitle:'Gmail · Drive · Docs · Calendar', lane:'integration', order:1, kind:'integration', sourcePaths:['backend/src/lib/google/driveClient.ts','backend/src/lib/googleCalendarSync.ts','backend/src/lib/google/gmailClient.ts'], description:'Email, document collaboration and calendar integration.' },
  { id:'speechmatics', label:'Speechmatics', subtitle:'batch STT', lane:'integration', order:2, kind:'integration', sourcePaths:['backend/src/lib/speechmatics.ts','backend/src/routes/speechmatics.ts'], description:'Meeting and field-recording transcription with authenticated callbacks.' },
  { id:'aps', label:'Autodesk APS', subtitle:'RVT → SVF2 viewer', lane:'integration', order:3, kind:'integration', sourcePaths:['backend/src/routes/aps.ts','backend/src/lib/aps.ts'], description:'Model upload, translation and short-lived browser viewer tokens.' },
  { id:'push-provider', label:'Web Push', subtitle:'VAPID delivery', lane:'integration', order:4, kind:'integration', sourcePaths:['backend/src/lib/webPush.ts','backend/src/lib/pushSweep.ts'], description:'Browser notification delivery outside the active application session.' },
  { id:'mgl-control', label:'MGL AI Control Plane', subtitle:'permissions + context + tools', lane:'ai', order:0, kind:'service', sourcePaths:['backend/src/routes/mglAi.ts','backend/src/lib/mglai/contextBuilder.ts','docs/mgl-ai/ARCHITECTURE.md'], description:'Server-owned identity, live ERP tools, context, citations, conversations, feedback and release metadata.' },
  { id:'local-runtime', label:'Local AI Runtime', subtitle:'127.0.0.1:39217', lane:'ai', order:1, kind:'runtime', sourcePaths:['ai/runtime/src/server.ts','ai/runtime/src/turn.ts'], description:'Employee-PC inference service. It generates language but does not decide authorization.' },
  { id:'retrieval', label:'Norm Retrieval', subtitle:'hybrid local search', lane:'ai', order:2, kind:'runtime', sourcePaths:['ai/retrieval/src/pipeline.ts','ai/retrieval/src/search.ts','ai/norm-dataset'], description:'Local norm corpus ingestion, lexical/vector fusion and citations.' },
  { id:'llama', label:'llama.cpp + GGUF', subtitle:'local model engine', lane:'ai', order:3, kind:'runtime', sourcePaths:['ai/runtime/src/engine/LlamaCppEngine.ts','ai/runtime/src/modelManager.ts'], description:'Replaceable local inference engine and model lifecycle.' },
  { id:'remote-mcp', label:'Remote ERP MCP', subtitle:'/mcp + /sse', lane:'ai', order:4, kind:'service', sourcePaths:['backend/src/mcp/MglMcpAgent.ts','backend/src/mcp/guard.ts'], description:'OAuth-protected AI-native API for ERP projects, reports, email, QTO and executive tools.' },
  { id:'revit-addin', label:'MGL Revit Add-in', subtitle:'Revit 2024–2027', lane:'revit', order:0, kind:'app', sourcePaths:['revit-mcp/addin/App.cs','revit-mcp/README.md'], description:'Desktop BIM platform with ribbon tools, ERP integration, licensing and local automation.' },
  { id:'change-impact', label:'Change Impact', subtitle:'simulation + dependency radar', lane:'revit', order:1, kind:'service', sourcePaths:['revit-mcp/addin/ChangeImpact/Revit/ChangeImpactCommand.cs','revit-mcp/addin/ChangeImpact/Core/ImpactGraphBuilder.cs'], description:'Pre-change simulation, ghost geometry and downstream impact analysis.' },
  { id:'revit-tools', label:'Revit Tool Suite', subtitle:'publish · count · sheets · rebar · clash', lane:'revit', order:2, kind:'service', sourcePaths:['revit-mcp/addin/SmartPublish','revit-mcp/addin/SmartCount','revit-mcp/addin/SheetNumerator','revit-mcp/addin/Reinforcement','revit-mcp/addin/ClashCheck'], description:'Production BIM automation modules built directly on the Revit API.' },
  { id:'work-tracking', label:'Revit Work Tracking', subtitle:'automatic activity time', lane:'revit', order:3, kind:'service', sourcePaths:['revit-mcp/addin/WorkTracking/WorkTrackingHost.cs','backend/src/routes/revitTracking.ts'], description:'Automatic Revit work timing kept separate from the official task timer.' },
  { id:'bridge', label:'Local Revit Bridge', subtitle:'127.0.0.1:5005', lane:'revit', order:4, kind:'runtime', sourcePaths:['revit-mcp/addin/HttpServer.cs','revit-mcp/addin/RevitToolBus.cs','revit-mcp/server'], description:'Token-protected typed bridge from MCP clients into the live Revit API thread.' },
  { id:'local-agent', label:'Local Claude Agent', subtitle:'127.0.0.1:5099', lane:'revit', order:5, kind:'runtime', sourcePaths:['revit-mcp/agent/mgl_agent.py'], description:'Employee-owned Claude agent connected to typed local Revit tools.' },
  { id:'cron', label:'Cron Triggers', subtitle:'*/2 · every minute', lane:'surface', order:3, kind:'actor', sourcePaths:['backend/wrangler.toml','backend/src/index.ts'], description:'Cloudflare cron ticks: mail sync, meetings, Drive listener, push sweep, deadline and snapshot jobs. Each job reports its own D1 usage to the live view.' },
  { id:'teams', label:'Teams', subtitle:'boards + productivity', lane:'backend', order:19, kind:'domain', sourcePaths:['backend/src/routes/teams.ts','backend/src/lib/teamAccess.ts','frontend/src/features/teams/TeamDetailPage.tsx'], description:'Team boards, allocation, membership and the productivity tab.' },
  { id:'people', label:'Users & Auth', subtitle:'login · profiles · HR', lane:'backend', order:20, kind:'domain', sourcePaths:['backend/src/routes/auth.ts','backend/src/routes/users.ts','backend/src/routes/profiles.ts'], description:'Login, /auth/me, user administration, profiles and hours logs.' },
  { id:'dashboard', label:'Dashboard', subtitle:'company · ticker · leaderboard', lane:'backend', order:21, kind:'domain', sourcePaths:['backend/src/routes/dashboard.ts','backend/src/routes/company.ts','backend/src/routes/leaderboard.ts'], description:'Company overview, TV board, ticker, leaderboard and global search — the heaviest read paths, edge-cached.' },
  { id:'revit-api', label:'Revit API', subtitle:'/api/revit/*', lane:'backend', order:22, kind:'domain', sourcePaths:['backend/src/routes/revit.ts','backend/src/routes/revitLicense.ts','backend/src/routes/revitChangeNotices.ts'], description:'Add-in licensing, device keys, work context, submissions, tracking and change notices.' },
  { id:'workbench', label:'System Workbench', subtitle:'graph · code · tests · PR', lane:'frontend', order:4, kind:'app', sourcePaths:['frontend/src/features/system-workbench/SystemWorkbenchPage.tsx','backend/src/routes/devWorkbench.ts'], description:'This internal developer surface: architecture graph, GitHub-backed editing, fixed CI validation and draft PR creation.' },
];

export const WORKBENCH_EDGES: WorkbenchEdge[] = [
  {from:'staff',to:'browser',type:'http'},{from:'client-user',to:'browser',type:'http'},
  {from:'browser',to:'auth-ui',type:'local'},{from:'browser',to:'query',type:'local'},{from:'query',to:'api-client',type:'local'},
  {from:'api-client',to:'worker',type:'http',label:'HTTPS /api/*'},{from:'worker',to:'security',type:'local'},
  {from:'security',to:'projects',type:'local'},{from:'security',to:'tasks',type:'local'},{from:'security',to:'attendance',type:'local'},
  {from:'security',to:'documents',type:'local'},{from:'security',to:'asr',type:'local'},{from:'security',to:'client',type:'local'},
  {from:'security',to:'qto',type:'local'},{from:'security',to:'reports',type:'local'},{from:'security',to:'email',type:'local'},
  {from:'security',to:'meetings',type:'local'},{from:'security',to:'quotes',type:'local'},{from:'security',to:'compliance',type:'local'},
  {from:'projects',to:'tasks',type:'data'},{from:'tasks',to:'allocation',type:'data'},{from:'allocation',to:'progress',type:'data'},
  {from:'tasks',to:'progress',type:'data'},{from:'progress',to:'reports',type:'data'},{from:'attendance',to:'reports',type:'data'},
  {from:'projects',to:'documents',type:'data'},{from:'projects',to:'drive',type:'data'},{from:'projects',to:'asr',type:'data'},
  {from:'projects',to:'client',type:'data'},{from:'projects',to:'qto',type:'data'},{from:'projects',to:'reports',type:'data'},
  {from:'projects',to:'quotes',type:'data'},{from:'projects',to:'compliance',type:'data'},
  {from:'documents',to:'signing',type:'data'},{from:'drive',to:'signing',type:'data'},{from:'asr',to:'signing',type:'data'},
  {from:'client',to:'signing',type:'event'},{from:'client',to:'notifications',type:'event'},{from:'tasks',to:'notifications',type:'event'},
  {from:'attendance',to:'notifications',type:'event'},{from:'asr',to:'notifications',type:'event'},{from:'signing',to:'notifications',type:'event'},
  {from:'projects',to:'d1',type:'data'},{from:'tasks',to:'d1',type:'data'},{from:'allocation',to:'d1',type:'data'},
  {from:'progress',to:'d1',type:'data'},{from:'attendance',to:'d1',type:'data'},{from:'documents',to:'d1',type:'data'},
  {from:'asr',to:'d1',type:'data'},{from:'client',to:'d1',type:'data'},{from:'qto',to:'d1',type:'data'},
  {from:'reports',to:'d1',type:'data'},{from:'email',to:'d1',type:'data'},{from:'meetings',to:'d1',type:'data'},
  {from:'quotes',to:'d1',type:'data'},{from:'compliance',to:'d1',type:'data'},{from:'notifications',to:'d1',type:'data'},
  {from:'documents',to:'r2-media',type:'data'},{from:'asr',to:'r2-media',type:'data'},{from:'client',to:'r2-media',type:'data'},
  {from:'meetings',to:'r2-audio',type:'data'},{from:'client',to:'client-do',type:'event'},{from:'remote-mcp',to:'mcp-do',type:'data'},
  {from:'remote-mcp',to:'oauth-kv',type:'data'},
  {from:'reports',to:'browser-render',type:'render'},{from:'asr',to:'browser-render',type:'render'},
  {from:'quotes',to:'browser-render',type:'render'},{from:'meetings',to:'browser-render',type:'render'},{from:'projects',to:'browser-render',type:'render'},
  {from:'email',to:'google',type:'sync'},{from:'drive',to:'google',type:'sync'},{from:'worker',to:'google',type:'sync'},
  {from:'meetings',to:'speechmatics',type:'sync'},{from:'asr',to:'speechmatics',type:'sync'},
  {from:'projects',to:'aps',type:'sync'},{from:'notifications',to:'push-provider',type:'event'},
  {from:'browser',to:'mgl-control',type:'http'},{from:'browser',to:'local-runtime',type:'local'},
  {from:'mgl-control',to:'d1',type:'data'},{from:'mgl-control',to:'projects',type:'ai'},{from:'mgl-control',to:'tasks',type:'ai'},
  {from:'mgl-control',to:'attendance',type:'ai'},{from:'mgl-control',to:'compliance',type:'ai'},
  {from:'local-runtime',to:'retrieval',type:'ai'},{from:'local-runtime',to:'llama',type:'ai'},
  {from:'claude',to:'remote-mcp',type:'http'},{from:'remote-mcp',to:'projects',type:'ai'},{from:'remote-mcp',to:'reports',type:'ai'},
  {from:'remote-mcp',to:'email',type:'ai'},{from:'remote-mcp',to:'meetings',type:'ai'},{from:'remote-mcp',to:'qto',type:'ai'},
  {from:'revit-addin',to:'worker',type:'http',label:'/api/revit/*'},{from:'revit-addin',to:'qto',type:'http'},
  {from:'revit-addin',to:'work-tracking',type:'local'},{from:'revit-addin',to:'change-impact',type:'local'},{from:'revit-addin',to:'revit-tools',type:'local'},
  {from:'work-tracking',to:'worker',type:'http'},{from:'revit-addin',to:'bridge',type:'local'},
  {from:'local-agent',to:'bridge',type:'local'},{from:'claude',to:'local-agent',type:'local'},{from:'bridge',to:'revit-addin',type:'local'},
  {from:'revit-addin',to:'mgl-control',type:'ai'},{from:'workbench',to:'worker',type:'http'},{from:'workbench',to:'mgl-control',type:'ai'},
  {from:'cron',to:'worker',type:'event',label:'scheduled()'},
  {from:'security',to:'teams',type:'local'},{from:'security',to:'people',type:'local'},{from:'security',to:'dashboard',type:'local'},
  {from:'security',to:'revit-api',type:'local'},{from:'security',to:'mgl-control',type:'local'},{from:'security',to:'drive',type:'local'},
  {from:'security',to:'notifications',type:'local'},{from:'security',to:'progress',type:'local'},{from:'security',to:'signing',type:'local'},
  {from:'security',to:'allocation',type:'local'},
  {from:'teams',to:'d1',type:'data'},{from:'people',to:'d1',type:'data'},{from:'dashboard',to:'d1',type:'data'},
  {from:'revit-api',to:'d1',type:'data'},{from:'drive',to:'d1',type:'data'},{from:'signing',to:'d1',type:'data'},
  {from:'worker',to:'r2-media',type:'data',label:'/media'},{from:'revit-addin',to:'revit-api',type:'http'},
];
