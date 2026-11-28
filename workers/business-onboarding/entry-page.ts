/** Same-origin entry surface. No database client, access token or third-party script. */
export async function entryPage(authOnly = false): Promise<Response> {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Sign in to DNA OS</title><link rel="stylesheet" href="/assets/fonts/dna-fonts.css" nonce="${nonce}">
<style nonce="${nonce}">
*{box-sizing:border-box} :root{font-family:var(--font-ui);color:#f4f7ff;background:#06101f;font-synthesis:none;text-rendering:optimizeLegibility;overflow:hidden}
html,body{width:100%;height:100%;overflow:hidden}body{margin:0;min-height:100dvh;height:100dvh;background:radial-gradient(ellipse at 80% 25%,#0b2d52 0,transparent 43%),#06101f;letter-spacing:.005em}
a{color:#8dcfff;text-decoration:none}a:hover{text-decoration:underline}
.topbar{height:64px;padding:0 clamp(20px,5vw,72px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1b2d45;background:rgba(6,16,31,.72)}
.brand{display:inline-flex;align-items:center}.brand img{display:block;width:142px;height:48px;max-height:48px;object-fit:contain;object-position:left center}
.topbar .back{font-size:14px;color:#bdc9dc}
main{width:min(100% - 32px,1060px);height:calc(100dvh - 64px);margin:0 auto;padding:10px 0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.card{width:100%;max-height:100%;overflow:hidden;padding:clamp(18px,2.8vh,26px) clamp(20px,3vw,34px);border:1px solid #203956;border-radius:20px;background:#0a1729;box-shadow:0 24px 70px #02091466}
.eyebrow{margin:0 0 10px;color:#64caff;font-size:12px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0;font-size:clamp(30px,6vw,38px);line-height:1.18;letter-spacing:-.035em}h2{font-size:22px;line-height:1.3;margin:0 0 12px}
.intro{margin:9px 0 16px;color:#b6c3d8;line-height:1.55;font-size:14px}
label{display:block;margin:18px 0 8px;color:#dce6f6;font-size:14px;font-weight:650}
input:not([type=checkbox]),textarea{width:100%;background:#071222;color:#f4f7ff;border:1px solid #2a4160;border-radius:10px;padding:13px 14px;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus{border-color:#42a5ff;box-shadow:0 0 0 3px #1686ff25}
button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:13px 18px;cursor:pointer;transition:filter .15s,transform .15s}
button:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}button:disabled{opacity:.55;cursor:wait}
.primary{width:100%;margin-top:16px;background:#3789ff;color:white}
.secondary{background:#12233a;color:#dceaff;border:1px solid #2c4668}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button{flex:1}
.muted{color:#aab9d0}.roles{display:grid;grid-template-columns:1fr 1fr;gap:8px}.roles label{border:1px solid #253c5b;padding:12px;border-radius:10px;margin:0}
#message{min-height:24px;margin:16px 0 0;color:#9ed8ff;font-size:14px;white-space:pre-line}
.secure-note{margin:14px 0 0;padding-top:12px;border-top:1px solid #20324b;color:#8fa2bf;font-size:11px;line-height:1.5}
.identity-flow{display:grid;grid-template-columns:minmax(0,1fr) 190px minmax(220px,.8fr);align-items:stretch;gap:16px;margin:16px 0}
.flow-side{min-width:0;padding:14px;border:1px solid #203956;border-radius:15px;background:#081629}
.flow-label{margin:0 0 10px;color:#85b9e8;font-size:11px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}
.provider-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.provider{display:flex;align-items:center;gap:10px;min-height:42px;padding:7px 10px;border:1px solid #243b59;border-radius:11px;background:#0c1c32;color:#e7eefb;font-size:13px;font-weight:650;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background-color .18s ease}
.provider:hover,.provider:focus-visible{transform:translateY(-3px) scale(1.02);border-color:#55b7ff;background:#102542;box-shadow:0 8px 20px #1686ff25;outline:none}
.provider:active{transform:translateY(-1px) scale(.99)}
.provider-mark{display:grid;place-items:center;flex:0 0 27px;width:27px;height:27px;border-radius:8px;background:#122947;color:#b9dcff;font-size:16px;font-weight:800;transition:transform .18s ease}
.provider:hover .provider-mark,.provider:focus-visible .provider-mark{transform:scale(1.1)}
.provider-mark svg,.provider-mark img{width:18px;height:18px;display:block;object-fit:contain}
.provider-google{padding:0;border:0;background:transparent;box-shadow:none;overflow:hidden}.provider-google img{display:block;width:100%;height:42px;object-fit:contain}.provider-google:hover,.provider-google:focus-visible{background:transparent;box-shadow:0 7px 18px #196fd51a}
.provider:not(a){cursor:default}.provider:not(a):hover{transform:none;border-color:#d4deea;background:#fff;box-shadow:0 1px 2px #13284408}.provider:not(a):hover .provider-mark{transform:none}
.provider-mark.email{background:#123457;color:#74caff}
.bridge{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-width:0;color:#9eb0ca;text-align:center}
.bridge-label{margin:0;color:#69c9ff;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.bridge-flow{display:flex;align-items:center;justify-content:center;width:100%;gap:7px}
.bridge-flow:before,.bridge-flow:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,#348bd2)}
.bridge-flow:after{background:linear-gradient(90deg,#348bd2,transparent)}
.bridge-core{display:grid;place-items:center;width:116px;min-height:82px;padding:10px 8px;border:1px solid #2f5a82;border-radius:13px;background:#0b2038;box-shadow:inset 0 0 22px #1686ff13}
.bridge-core svg{width:23px;height:23px;margin-bottom:4px;color:#69c9ff}
.bridge-core strong{font-size:13px;color:#f4f7ff}.bridge-core small{font-size:9px;color:#9cc8ee}.bridge-core span{font-size:10px;color:#93a9c8}
.bridge-arrow{display:grid;place-items:center;flex:0 0 20px;color:#66ceff;line-height:1;filter:drop-shadow(0 0 5px #1686ff55)}
.bridge-arrow svg{display:block;width:18px;height:18px;overflow:visible}
.dnaos-node{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px}
.dnaos-node img{width:146px;height:auto;max-height:54px;object-fit:contain}.dnaos-node strong{font-size:15px}.dnaos-node span{font-size:12px;line-height:1.5;color:#9eb0ca}
.flow-caption{margin:0;color:#849ab8;font-size:11px;line-height:1.5;text-align:center}
.email-divider{display:flex;align-items:center;gap:12px;margin:4px 0 12px;color:#92a8c5;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.email-divider:before,.email-divider:after{content:"";height:1px;flex:1;background:#22364f}
.login-method{max-width:520px;margin:0 auto}
[hidden]{display:none!important}fieldset{border:1px solid #2a4160;border-radius:12px;margin-top:20px;padding:12px}legend{padding:0 6px;color:#c6d7ee;font-weight:650}
.bridge-arrow svg path{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media(max-width:760px){.topbar{height:64px}.brand img{width:142px;height:48px;max-height:48px}main{width:min(100% - 24px,520px);height:calc(100dvh - 64px);padding:8px 0}.card{padding:16px}.identity-flow{grid-template-columns:1fr;gap:8px;margin:10px 0}.provider-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.provider{min-height:38px;font-size:12px;padding:6px 8px}.provider-mark{width:24px;height:24px;flex-basis:24px}.bridge{min-height:38px;flex-direction:row;gap:8px}.bridge-label{display:none}.bridge-flow{width:auto;gap:4px}.bridge-flow:before,.bridge-flow:after{display:none}.bridge-core{width:auto;min-height:34px;padding:5px 10px;display:flex;gap:6px}.bridge-core svg{width:17px;height:17px;margin:0}.bridge-core small{font-size:9px}.bridge-core strong{font-size:11px}.bridge-core span{font-size:9px}.bridge-arrow{display:grid;flex-basis:16px}.bridge-arrow svg{width:15px;height:15px}.flow-caption{display:none}.dnaos-node{flex-direction:row;gap:8px;justify-content:flex-start;text-align:left}.dnaos-node .flow-label{margin:0}.dnaos-node img{width:78px;max-height:30px}.dnaos-node strong{font-size:12px}.dnaos-node span{font-size:10px}.email-divider{margin:3px 0 8px}.secure-note{margin-top:9px;padding-top:8px;font-size:10px}}
@media(max-width:440px){.provider-list{grid-template-columns:repeat(2,minmax(0,1fr))}.intro{font-size:13px;margin:7px 0 11px}.flow-side{padding:10px}.email-divider{font-size:10px}}
@media(max-height:620px){.topbar{height:64px}.brand img{width:142px;height:48px;max-height:48px}main{height:calc(100dvh - 64px)}.card{padding:12px 18px}h1{font-size:30px}.intro{margin:6px 0 9px}.identity-flow{margin:8px 0;gap:9px}.flow-side{padding:10px}.provider{min-height:36px}.secure-note{margin-top:8px;padding-top:8px}}
@media(prefers-reduced-motion:reduce){.provider,.provider-mark{transition:none}}
:root{color:#152238;background:#fff}
body{background:#fff;color:#152238}
.topbar{background:#fff;border-bottom:0}
.brand{gap:0;color:#152238;text-decoration:none}.brand img{display:block;width:142px;height:48px;max-height:48px;object-fit:contain;object-position:left center;border-radius:0;background:transparent;padding:0}
.identity-brand img{width:184px;height:62px;max-height:62px;object-fit:contain;object-position:center;border-radius:0;background:transparent;padding:0}
.topbar .back{display:inline-flex;align-items:center;gap:8px;padding:9px 13px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#24466e;font-size:14px;font-weight:650;transition:border-color .16s,background-color .16s,color .16s,box-shadow .16s}
.topbar .back:before{content:none}
.topbar .back:hover{border-color:#3988e8;background:#f3f8ff;color:#125bb2;box-shadow:0 2px 8px #1b5eaa12;text-decoration:none}
.topbar .back:focus-visible{outline:3px solid #2684ff55;outline-offset:2px}
.card{border-color:#d8e0ea;background:#fff;box-shadow:0 18px 55px #15223812}
h1,h2{color:#152238}
.intro{color:#52627a}
.flow-side{border-color:#dce4ee;background:#f7f9fc}
.flow-label{color:#476889}
.provider{border-color:#d4deea;background:#fff;color:#172943;box-shadow:0 1px 2px #13284408}
.provider:hover,.provider:focus-visible{border-color:#3988e8;background:#f4f8ff;box-shadow:0 7px 18px #196fd51a}
.provider-mark{background:#eaf2fb;color:#2464a4}
.provider-mark.generic{background:#edf3f9;color:#45617e}
.provider-mark.email{background:#e6f3ff;color:#1477bb}
.bridge{color:#536782}
.bridge-label{color:#177cb8}
.bridge-flow:before,.bridge-flow:after{background:linear-gradient(90deg,transparent,#9bc8eb)}
.bridge-flow:after{background:linear-gradient(90deg,#9bc8eb,transparent)}
.bridge-arrow{color:#1688d4;filter:none}
.bridge-core{border-color:#a9cae7;background:#f0f7ff;box-shadow:inset 0 0 20px #1686ff0a}
.bridge-core strong{color:#152238}.bridge-core small,.bridge-core span{color:#526b88}
.dnaos-node span,.flow-caption{color:#5d6f88}
.identity-brand{display:flex;align-items:center;justify-content:center}
.dnaos-node{background:#fff}
@media(max-width:760px){.identity-brand img{width:142px;height:48px;max-height:48px}}
.email-divider{color:#536782}.email-divider:before,.email-divider:after{background:#dce4ee}
label{color:#24364e}
input:not([type=checkbox]),textarea{background:#fff;color:#152238;border-color:#cbd7e5}
input::placeholder,textarea::placeholder{color:#8b98a9}
.muted,.secure-note{color:#64748b}
.secure-note{border-top-color:#e1e7ef}
.secondary{background:#f4f7fb;color:#213a59;border-color:#cbd7e5}
.roles label,fieldset{border-color:#d4deea}
legend{color:#344b68}
#message{color:#275477}
.provider.provider-google:hover,.provider.provider-google:focus-visible{transform:none;border:0;background:transparent;box-shadow:none}.provider.provider-google:focus-visible{outline:3px solid #2684ff55;outline-offset:2px}
@media(max-width:760px),(max-height:560px){:root{overflow-x:hidden;overflow-y:auto}html,body{height:auto;min-height:100%;overflow-x:hidden;overflow-y:auto}body{height:auto;min-height:100dvh}main{height:auto;min-height:calc(100dvh - 64px);align-items:flex-start;overflow:visible;padding:10px 0 20px}.card{max-height:none;overflow:visible}}
</style>
<header class="topbar"><a class="brand" href="/workspace" aria-label="DNA OS workspace"><img src="/assets/brand/dna-os/v1/dna-os-horizontal-color.png" alt="DNA OS"></a><a class="back" href="/workspace">Back to DNA OS</a></header>
<main><div class="card"><header><p class="eyebrow">DNA OS · Secure access</p><h1>Sign in to your account</h1><p class="intro">One identity for DNA OS. Choose an identity source, then follow its connection into your account.</p></header>
<section class="identity-flow" aria-label="Identity connection flow">
  <div class="flow-side"><p class="flow-label">Identity sources</p><div class="provider-list">
    <div class="provider" data-auth-provider="apple"><span class="provider-mark generic" aria-hidden="true"><img src="/assets/dna-os-integration-generic.svg" alt=""></span>Apple</div>
    <a class="provider provider-google" data-auth-provider="google" href="/auth/google?next=%2Fworkspace" aria-label="Sign in with Google"><img src="/assets/providers/google/signin-light-pill-android-web@2x.png" alt="Sign in with Google"></a>
    <div class="provider" data-auth-provider="facebook"><span class="provider-mark generic" aria-hidden="true"><img src="/assets/dna-os-integration-generic.svg" alt=""></span>Facebook</div>
    <div class="provider" data-auth-provider="line"><span class="provider-mark generic" aria-hidden="true"><img src="/assets/dna-os-integration-generic.svg" alt=""></span>LINE</div>
    <div class="provider" data-auth-provider="tiktok"><span class="provider-mark generic" aria-hidden="true"><img src="/assets/dna-os-integration-generic.svg" alt=""></span>TikTok</div>
    <div class="provider" data-auth-provider="email"><span class="provider-mark email" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg></span>Email OTP</div>
  </div></div>
  <div class="bridge" aria-label="Secure connection" data-connection-slot="provider-callback-account-match-session"><p class="bridge-label">Secure sign-in</p><div class="bridge-flow"><span class="bridge-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h17m-6-6 6 6-6 6"/></svg></span><div class="bridge-core"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg><small>SECURE</small><strong>One identity</strong><span>DNA OS session</span></div><span class="bridge-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h17m-6-6 6 6-6 6"/></svg></span></div><p class="flow-caption">Verified identity · one account</p></div>
  <div class="flow-side dnaos-node" data-identity-target="dnaos-session"><p class="flow-label">Single account</p><div class="identity-brand"><img src="/assets/brand/dna-os/v1/dna-os-horizontal-color.png" alt="DNA OS"></div><strong>DNA OS identity</strong><span>One account · permissions follow the organization</span></div>
</section>
<div class="email-divider">Email verification</div>
<section id="login" class="login-method"><form id="emailForm"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email" placeholder="name@company.com"><button class="primary">Send a sign-in code</button></form><form id="otpForm" hidden><label for="code">Enter the six-digit code</label><input id="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code" placeholder="000000"><div class="actions"><button class="primary">Verify and continue</button><button class="secondary" id="back" type="button">Use another email</button></div></form></section>
<section id="intake" hidden><h2>2. Set up your profile</h2><p class="muted">Select all roles that apply. These choices help tailor your next steps. Business access requires separate authorization.</p><form id="profileForm"><label for="displayName">Contact name</label><input id="displayName" required maxlength="120" autocomplete="name"><div class="roles"><label><input type="checkbox" name="role" value="driver"> Driver</label><label><input type="checkbox" name="role" value="business_owner"> Business owner</label><label><input type="checkbox" name="role" value="employee"> Staff member</label><label><input type="checkbox" name="role" value="service_provider"> Service provider</label></div>
<fieldset id="driverFields" hidden><legend>Driving details</legend><label for="vehicleType">Vehicle type</label><input id="vehicleType" maxlength="500" placeholder="e.g., six-wheel truck"><label for="serviceArea">Service area</label><input id="serviceArea" maxlength="500" placeholder="e.g., Khon Kaen and nearby provinces"></fieldset>
<fieldset id="businessFields" hidden><legend>Your business</legend><label for="businessName">Business, store, or production site name</label><input id="businessName" maxlength="500"><label for="activities">Business activities</label><input id="activities" maxlength="500" placeholder="e.g., manufacture materials, sell goods, or provide transport"></fieldset>
<label for="needs">What would you like to do with DNA OS?</label><textarea id="needs" maxlength="500" rows="3" placeholder="e.g., find transport work, connect an ERP, or manage business information"></textarea><button class="primary">Save profile</button></form><div id="next" hidden><h2>3. Next steps</h2><p id="nextText"></p><button class="secondary" id="edit" type="button">Edit profile</button></div><button class="secondary" id="logout" type="button">Sign out</button></section><p id="message" role="status" aria-live="polite"></p><p class="secure-note">Signing in confirms your identity. Access to company data and actions always follows your assigned organization permissions.</p></div></main>
<script nonce="${nonce}">
const el=id=>document.getElementById(id);let csrf='',email='',busy=false;
const messages={RATE_LIMITED:'Too many attempts. Please wait and try again.',OTP_INVALID:'The code is invalid or expired. Request a new one.',AUTH_NOT_CONFIGURED:'Email service is currently unavailable. Try again later.',CSRF_REJECTED:'This page has expired. Reload the page and try again.',AUTH_REQUIRED:'Please sign in again.',AUTH_INVALID:'Please sign in again.',PROFILE_SAVE_FAILED:'We could not save your profile. Try again.',DRIVER_DETAILS_REQUIRED:'Enter your vehicle type and service area.',BUSINESS_DETAILS_REQUIRED:'Enter your business name and activities.',ROLES_INVALID:'Select at least one role.'};
function say(text){el('message').textContent=text}
async function call(path,body){const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'content-type':'application/json','x-dna-csrf':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});const data=r.status===204?{}:await r.json();if(!r.ok)throw new Error(messages[data.error]||'Something went wrong. Try again.');return data}
async function command(name,input){return call('/api/gateway',{capability_id:name,input})}
async function run(task){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);say('Working…');try{await task()}catch(e){say(e.message)}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
function roles(){return [...document.querySelectorAll('input[name=role]:checked')].map(i=>i.value)}
function fields(){const r=roles();el('driverFields').hidden=!r.includes('driver');el('businessFields').hidden=!r.includes('business_owner');el('vehicleType').required=el('serviceArea').required=r.includes('driver');el('businessName').required=el('activities').required=r.includes('business_owner')}
document.querySelectorAll('input[name=role]').forEach(i=>i.addEventListener('change',fields));
function saved(data){el('profileForm').hidden=true;el('next').hidden=false;const r=data.roles||[];const steps=[];if(r.includes('driver'))steps.push('Driver: Verify your vehicle details and eligibility to accept work.');if(r.includes('business_owner'))steps.push('Business owner: Verify ownership and business details.');if(r.includes('employee'))steps.push('Staff member: Ask the business to grant you access.');if(r.includes('service_provider'))steps.push('Service provider: Describe your services and verify the provider account.');el('nextText').textContent=steps.join(' / ')+' — Your profile is saved. Verification and capability activation are not available yet.';say('Profile saved.')}
async function openProfile(){if(${authOnly}){location.replace('/workspace');return;}el('login').hidden=true;el('intake').hidden=false;const {data}=await command('onboarding.read',{});if(data){el('displayName').value=data.display_name||'';document.querySelectorAll('input[name=role]').forEach(i=>i.checked=(data.roles||[]).includes(i.value));const d=data.details||{};for(const [id,key] of [['vehicleType','vehicle_type'],['serviceArea','service_area'],['businessName','business_name'],['activities','activities'],['needs','needs']])el(id).value=d[key]||'';fields();saved(data)}else say('Account verified. Please complete your profile.')}
el('emailForm').onsubmit=e=>{e.preventDefault();run(async()=>{email=el('email').value.trim();await call('/v1/auth/otp',{email});el('emailForm').hidden=true;el('otpForm').hidden=false;el('code').focus();say('If an account exists for this address, you will receive a code by email.')})};
el('otpForm').onsubmit=e=>{e.preventDefault();run(async()=>{await call('/v1/auth/verify',{email,code:el('code').value});el('code').value='';await openProfile()})};
el('back').onclick=()=>{el('emailForm').hidden=false;el('otpForm').hidden=true;el('code').value='';say('Enter your email address to request a new code.')};
el('profileForm').onsubmit=e=>{e.preventDefault();run(async()=>{const r=roles();if(!r.length)throw new Error(messages.ROLES_INVALID);const details={needs:el('needs').value};if(r.includes('driver')){details.vehicle_type=el('vehicleType').value;details.service_area=el('serviceArea').value}if(r.includes('business_owner')){details.business_name=el('businessName').value;details.activities=el('activities').value}const {data}=await command('onboarding.save',{display_name:el('displayName').value,roles:r,details});saved(data)})};
el('edit').onclick=()=>{el('profileForm').hidden=false;el('next').hidden=true;say('Save your changes when you are done.')};
el('logout').onclick=()=>run(async()=>{await call('/v1/auth/logout',{});location.replace('/')});
run(async()=>{csrf=(await call('/v1/auth/csrf')).csrf_token;const session=await fetch('/v1/auth/session',{credentials:'same-origin'});if(session.ok){await openProfile();return}if(session.status===401){const refresh=await fetch('/v1/auth/refresh',{method:'POST',credentials:'same-origin',headers:{'x-dna-csrf':csrf}});if(refresh.ok){await openProfile();return}csrf=(await call('/v1/auth/csrf')).csrf_token;}say(new URLSearchParams(location.search).get('error')==='oauth_failed'?'Google sign-in could not be completed. Check the provider configuration and try again.':'Enter the email address for your existing DNA OS account.')});
</script></html>`, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; font-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}
