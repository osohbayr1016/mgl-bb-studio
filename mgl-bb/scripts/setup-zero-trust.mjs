#!/usr/bin/env node
/*
 * One-shot Cloudflare Zero Trust bootstrap for the mgl-progress org.
 *
 * What it does (idempotent — safe to re-run):
 *   1. Verifies the API token + account.
 *   2. Adds an "Email OTP" login method so staff can sign in without
 *      needing Google / Microsoft Workspace.
 *   3. Adds a WARP device-enrollment rule restricted to a given email
 *      domain (or list of explicit emails).
 *   4. Enables TLS decryption on the Gateway (so Upload File Size /
 *      Upload Mime Type selectors actually work — without this the
 *      payload is just opaque bytes to Cloudflare).
 *   5. Creates two HTTP traffic policies:
 *        • "Track uploads over 50MB"  — Allow + Logging
 *        • "Track file-sharing apps"  — Allow + Logging
 *      (Both default to Allow so nothing breaks day-1; flip to Block
 *      later from the dashboard if the CEO wants enforcement.)
 *   6. Prints next-step links: WARP installer + the Cloudflare CA
 *      certificate that must be installed as a Trusted Root on every
 *      employee laptop.
 *
 * Usage (PowerShell):
 *   $env:CF_API_TOKEN = "<paste-token>"
 *   $env:CF_ACCOUNT_ID = "<your-cloudflare-account-id>"
 *   $env:CF_TEAM_NAME  = "<your-zero-trust-team-slug>"   # optional
 *   $env:STAFF_EMAIL_DOMAIN = "your-company.mn"   # or omit to use a list
 *   node scripts/setup-zero-trust.mjs
 *
 * Optional env:
 *   STAFF_EMAILS = "alice@x.com,bob@y.com"        # used when no domain
 */

const API = 'https://api.cloudflare.com/client/v4';

const TOKEN      = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
/**
 * Zero Trust баг (team) -ийн slug — ажилтны WARP клиент дээр бичих нэр.
 * Урьд нь `anandoctane4` гэж ШУУД бичигдсэн байсан тул өөр компанид энэ
 * скрипт буруу заавар хэвлэдэг байв.  Тохируулаагүй бол доор Cloudflare-ийн
 * API-аас уншина; тэр ч бүтэлгүйтвэл орлуулагч тэмдэг үлдээнэ.
 */
let TEAM_NAME = process.env.CF_TEAM_NAME ?? '<your-team-slug>';
const DOMAIN     = (process.env.STAFF_EMAIL_DOMAIN ?? '').trim();
const EMAILS     = (process.env.STAFF_EMAILS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!TOKEN || !ACCOUNT_ID) {
  console.error('❌ CF_API_TOKEN and CF_ACCOUNT_ID env vars are required.');
  process.exit(1);
}
if (!DOMAIN && EMAILS.length === 0) {
  console.error('❌ Either STAFF_EMAIL_DOMAIN or STAFF_EMAILS must be set.');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Tiny HTTP helper                                                            */
/* -------------------------------------------------------------------------- */
async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errs = json.errors ? JSON.stringify(json.errors) : res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${errs}`);
  }
  return json.result;
}

/* -------------------------------------------------------------------------- */
/* 1. Verify token + account                                                   */
/* -------------------------------------------------------------------------- */
console.log('▶  Verifying API token…');
const verify = await cf('GET', '/user/tokens/verify');
console.log(`   ✓ Token "${verify.id}" is ${verify.status}`);
console.log(`   ✓ Account: ${ACCOUNT_ID}`);

// Zero Trust баг (team) -ийн slug-ийг ӨӨРӨӨ олж авна.  `auth_domain` нь
// `<slug>.cloudflareaccess.com` хэлбэртэй ирдэг.  Гараар өгсөн `CF_TEAM_NAME`
// давамгайлна; аль нь ч бүтэлгүйтвэл орлуулагч тэмдэг үлдэж, доорх зааварт
// «<your-team-slug>» гэж харагдана — буруу нэр хэвлэхээс дээр.
if (!process.env.CF_TEAM_NAME) {
  try {
    const org = await cf('GET', `/accounts/${ACCOUNT_ID}/access/organizations`);
    const authDomain = Array.isArray(org) ? org[0]?.auth_domain : org?.auth_domain;
    if (typeof authDomain === 'string' && authDomain.includes('.')) {
      TEAM_NAME = authDomain.split('.')[0];
      console.log(`   ✓ Zero Trust team: ${TEAM_NAME}`);
    }
  } catch {
    // Zero Trust идэвхжээгүй эсвэл токенд эрх дутуу — заавал биш.
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Email OTP login method                                                   */
/* -------------------------------------------------------------------------- */
console.log('\n▶  Configuring Email OTP login method…');
{
  const existing = await cf('GET', `/accounts/${ACCOUNT_ID}/access/identity_providers`);
  const otp = existing.find((p) => p.type === 'onetimepin');
  if (otp) {
    console.log(`   ✓ Already exists (id=${otp.id})`);
  } else {
    const created = await cf('POST', `/accounts/${ACCOUNT_ID}/access/identity_providers`, {
      name:   'One-time PIN',
      type:   'onetimepin',
      config: {},
    });
    console.log(`   ✓ Created (id=${created.id})`);
  }
}

/* -------------------------------------------------------------------------- */
/* 3. WARP device-enrollment rule                                              */
/* -------------------------------------------------------------------------- */
console.log('\n▶  Configuring WARP device-enrollment policy…');
let enrollmentPolicyId;
{
  // The "device enrollment" config lives under the dedicated devices/policy
  // endpoint — it gates who is *allowed* to enrol the WARP client, which
  // is exactly the audience we want to limit to "staff only".
  const includeRule = DOMAIN
    ? [{ email_domain: { domain: DOMAIN } }]
    : EMAILS.map((e) => ({ email: { email: e } }));

  const existing = await cf('GET', `/accounts/${ACCOUNT_ID}/access/policies`);
  const found = existing.find((p) => p.name === 'mgl-staff-enrollment');

  const payload = {
    name:      'mgl-staff-enrollment',
    decision:  'allow',
    include:   includeRule,
    require:   [],
    exclude:   [],
    precedence: 1,
  };

  if (found) {
    await cf('PUT', `/accounts/${ACCOUNT_ID}/access/policies/${found.id}`, payload);
    enrollmentPolicyId = found.id;
    console.log(`   ✓ Updated existing enrollment policy (id=${found.id})`);
  } else {
    const created = await cf('POST', `/accounts/${ACCOUNT_ID}/access/policies`, payload);
    enrollmentPolicyId = created.id;
    console.log(`   ✓ Created enrollment policy (id=${created.id})`);
  }
}

/* -------------------------------------------------------------------------- */
/* 3b. Attach the policy to the WARP device-enrolment Access app              */
/*     (otherwise the policy exists but no one is actually allowed in!)        */
/* -------------------------------------------------------------------------- */
console.log('\n▶  Linking policy to the WARP device-enrolment app…');
{
  // Discover the available identity providers so we can list them on the app.
  // OneTimePin is created above, but the org may already have others.
  const idps = await cf('GET', `/accounts/${ACCOUNT_ID}/access/identity_providers`);
  const idpIds = idps.map((p) => p.id);

  const apps = await cf('GET', `/accounts/${ACCOUNT_ID}/access/apps`);
  const warpApp = apps.find((a) => a.type === 'warp');

  const appPayload = {
    name:                       'WARP',
    type:                       'warp',
    session_duration:           '24h',
    auto_redirect_to_identity:  false,
    allowed_idps:               idpIds,
    policies:                   [{ id: enrollmentPolicyId, precedence: 1 }],
  };

  if (warpApp) {
    await cf('PUT', `/accounts/${ACCOUNT_ID}/access/apps/${warpApp.id}`, appPayload);
    console.log(`   ✓ Updated WARP app (id=${warpApp.id})`);
  } else {
    const created = await cf('POST', `/accounts/${ACCOUNT_ID}/access/apps`, appPayload);
    console.log(`   ✓ Created WARP app (id=${created.id})`);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Enable TLS decryption on Gateway                                         */
/* -------------------------------------------------------------------------- */
console.log('\n▶  Enabling TLS decryption (Gateway)…');
{
  // The configuration endpoint accepts a partial PATCH-style PUT. We only
  // toggle the bits we care about and leave the rest of the account
  // settings untouched.
  const cur = await cf('GET', `/accounts/${ACCOUNT_ID}/gateway/configuration`);
  const settings = cur.settings ?? {};
  settings.tls_decrypt = { enabled: true };
  settings.protocol_detection = { enabled: true };
  settings.activity_log = { enabled: true };

  await cf('PUT', `/accounts/${ACCOUNT_ID}/gateway/configuration`, { settings });
  console.log('   ✓ TLS decrypt = ON, Protocol detection = ON, Activity log = ON');
}

/* -------------------------------------------------------------------------- */
/* 5. HTTP traffic policies                                                    */
/* -------------------------------------------------------------------------- */
console.log('\n▶  Creating HTTP traffic policies…');
{
  const existing = await cf('GET', `/accounts/${ACCOUNT_ID}/gateway/rules`);

  async function upsertRule(rule) {
    const found = existing.find((r) => r.name === rule.name);
    if (found) {
      await cf('PUT', `/accounts/${ACCOUNT_ID}/gateway/rules/${found.id}`, rule);
      console.log(`   ✓ Updated: ${rule.name}`);
    } else {
      const created = await cf('POST', `/accounts/${ACCOUNT_ID}/gateway/rules`, rule);
      console.log(`   ✓ Created: ${rule.name} (id=${created.id})`);
    }
  }

  // Rule A — log every upload greater than 50 MiB. Action=allow so users
  // are not interrupted; CEO can view the offenders in Insights → Logs.
  // NOTE: Cloudflare's `http.upload.file.size` selector is denominated in
  // mebibytes (MiB), *not* bytes — so "50" really means ~50 MiB.
  await upsertRule({
    name:        'Track uploads over 50MB',
    description: 'CEO request — log all HTTP/S uploads above 50 MiB',
    enabled:     true,
    action:      'allow',
    filters:     ['http'],
    traffic:     'http.upload.file.size > 50',
    rule_settings: {},
  });

  // Rule B — log all access to common file-sharing services. Switch to
  // 'block' later if the org wants enforcement, not just visibility.
  // App IDs were fetched from /accounts/:id/gateway/app_types:
  //   521  = box       538 = Dropbox          554 = Google Drive
  //   596  = OneDrive  637 = WeTransfer       2867 = Mega
  //   2890 = Icedrive
  await upsertRule({
    name:        'Track file-sharing apps',
    description: 'CEO request — log Drive/Dropbox/WeTransfer/OneDrive/Box/Mega/Icedrive traffic',
    enabled:     true,
    action:      'allow',
    filters:     ['http'],
    traffic:     'any(app.ids[*] in {521 538 554 596 637 2867 2890})',
    rule_settings: {},
  });
}

/* -------------------------------------------------------------------------- */
/* 6. Print next steps                                                         */
/* -------------------------------------------------------------------------- */
console.log('\n══════════════════════════════════════════════════════════');
console.log('✅ Cloudflare Zero Trust bootstrap complete.');
console.log('══════════════════════════════════════════════════════════');
console.log('\nNext steps for each employee laptop:');
console.log('  1) Install the WARP client:');
console.log('       https://one.one.one.one/');
console.log('  2) Open WARP → Settings → "Login with Cloudflare Zero Trust".');
console.log(`     Team name:  ${TEAM_NAME}`);
console.log('     Sign in with the company email; a 6-digit PIN is mailed.');
console.log('  3) Install the Cloudflare root CA so TLS-decrypted sites');
console.log('     do not show certificate errors:');
console.log(`       https://${ACCOUNT_ID}.cloudflareaccess.com/cdn-cgi/access/cert/cf-root.pem`);
console.log('     • Windows: certmgr.msc → Trusted Root Certification Authorities → Import');
console.log('     • macOS:   Keychain Access → System → drag .pem → Always Trust');
console.log('\nMonitoring (CEO dashboard):');
console.log(`  Logs:      https://one.dash.cloudflare.com/${ACCOUNT_ID}/insights/logs/gateway`);
console.log(`  Analytics: https://one.dash.cloudflare.com/${ACCOUNT_ID}/insights/analytics`);
console.log('');
