const CFG = (window.NETCHAT_CONFIG || window.HECHAT_CONFIG) || {};
const ROOMS = Array.isArray(CFG.rooms) ? CFG.rooms : [];

// --- Cognito ---
// Allow overrides from localStorage
function getCfgRegion() {
  return (
    localStorage.getItem("cog_region") ||
    (window.NETCHAT_CONFIG && window.NETCHAT_CONFIG.region) ||
    (window.HECHAT_CONFIG && window.HECHAT_CONFIG.region) ||
    CFG.region ||
    "us-east-1"
  );
}
function getCfgClientId() {
  return (
    localStorage.getItem("cog_client_id") ||
    (window.NETCHAT_CONFIG && window.NETCHAT_CONFIG.clientId) ||
    (window.HECHAT_CONFIG && window.HECHAT_CONFIG.clientId) ||
    CFG.clientId ||
    ""
  );
}
function getCfgUserPoolId() {
  return (
    localStorage.getItem("cog_user_pool_id") ||
    (window.NETCHAT_CONFIG && window.NETCHAT_CONFIG.userPoolId) ||
    (window.HECHAT_CONFIG && window.HECHAT_CONFIG.userPoolId) ||
    CFG.userPoolId ||
    ""
  );
}

function saveTokens(result) {
  if (!result) return;
  const { IdToken, AccessToken, RefreshToken } = result;
  if (IdToken) localStorage.setItem("cognito_id_token", IdToken);
  if (AccessToken) localStorage.setItem("cognito_access_token", AccessToken);
  if (RefreshToken) localStorage.setItem("cognito_refresh_token", RefreshToken);
  // Just for backward compatibility (trust in stack overflow)
  if (IdToken) localStorage.setItem("cognito_token", IdToken);
}

function getIdToken() {
  return (
    localStorage.getItem("cognito_id_token") ||
    localStorage.getItem("cognito_token") ||
    null
  );
}
function getAccessToken() { return localStorage.getItem("cognito_access_token"); }
function clearTokens() {
  localStorage.removeItem("cognito_id_token");
  localStorage.removeItem("cognito_access_token");
  localStorage.removeItem("cognito_refresh_token");
  localStorage.removeItem("cognito_token");
}

function COG_ENDPOINT() {
  return `https://cognito-idp.${getCfgRegion()}.amazonaws.com/`;
}
async function cognitoRequest(target, body) {
  const res = await fetch(COG_ENDPOINT(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": target
    },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.__type || data.errorType) {
    const msg = data.message || data.__type || data.errorType || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- Direct login handler ---
async function loginDirect(username, password) {
  const clientId = getCfgClientId();
  if (!clientId) throw new Error("Missing Cognito ClientId");
  const data = await cognitoRequest(
    "AWSCognitoIdentityProviderService.InitiateAuth",
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password }
    }
  );
  const result = data.AuthenticationResult;
  if (!result?.IdToken) throw new Error("No token returned");
  saveTokens(result);
  loginBtn.textContent = "Logged In ✓";
  loginBtn.disabled = true;
}

async function logout() {
  try {
    const at = getAccessToken();
    if (at) {
      await cognitoRequest(
        "AWSCognitoIdentityProviderService.GlobalSignOut",
        { AccessToken: at }
      );
    }
  } catch (_) {
    // ignore errors, still clear client state
  } finally {
    clearTokens();
    alert("Logged out");
    location.reload();
  }
}

// --- Modal Utilities ---
const loginBtn = document.getElementById("loginBtn");
const backdrop = document.getElementById("modalBackdrop");
function closeModal() {
  backdrop.innerHTML = "";
  backdrop.style.display = "none";
}
function openModal(title, bodyHTML, onMount) {
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${title}</h3>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-actions">
        <button id="modalClose">Cancel</button>
      </div>
    </div>`;
  backdrop.style.display = "flex";
  document.getElementById("modalClose").onclick = closeModal;
  if (typeof onMount === "function") onMount();
}

// --- Login Modal ---
function openLoginModal() {
  openModal(
    "Log In",
    `
      <input id="userField" placeholder="Username">
      <input id="passField" type="password" placeholder="Password">
      <div class="hint">Use your NetChat credentials.</div>
      <div style="text-align:right"><a href="#" id="forgotLink">Forgot password?</a></div>
      <div id="loginError" class="hint" style="color:#ff8888;display:none;"></div>
    `,
    () => {
      const actions = document.querySelector('.modal-actions');
      const loginBtnEl = document.createElement('button');
      loginBtnEl.textContent = 'Log In';
      actions.insertBefore(loginBtnEl, document.getElementById('modalClose'));
      function showErr(m){ const el=document.getElementById('loginError'); el.textContent=m; el.style.display='block'; }
      const doSubmit = async () => {
        const u = document.getElementById('userField').value.trim();
        const p = document.getElementById('passField').value.trim();
        if (!u || !p) { showErr('Enter username & password'); return; }
        [loginBtnEl, document.getElementById('modalClose')].forEach(el=>el.disabled=true);
        try {
          await loginDirect(u, p);
          closeModal();
          initSocket();
        } catch (e) { showErr(e.message || 'Login failed'); }
        finally { [loginBtnEl, document.getElementById('modalClose')].forEach(el=>el.disabled=false); }
      };
      loginBtnEl.onclick = doSubmit;
      document.getElementById('passField').addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
      document.getElementById('forgotLink').onclick = (e) => { e.preventDefault(); closeModal(); openForgotModal(); };
    }
  );
}
loginBtn.onclick = openLoginModal;

// Auto mark loggedin state
const savedId = getIdToken();
if (savedId) {
  loginBtn.textContent = "Logged In ✓";
  loginBtn.disabled = true;
}

// --- Register Modal ---
const leftPanel = document.getElementById("left");
const registerBtn = document.createElement("button");
registerBtn.id = "registerBtn";
registerBtn.textContent = "Register";
leftPanel.insertBefore(registerBtn, loginBtn.nextSibling);

function openRegisterModal() {
  // SignUp
  const renderStep1 = () => openModal(
    "Register",
    `
      <input id="regUser" placeholder="Username">
      <input id="regEmail" type="email" placeholder="Email">
      <input id="regPass" type="password" placeholder="Password">
      <div class="hint">A confirmation code will be emailed to you.</div>
      <div id="regError" class="hint" style="color:#ff8888;display:none;"></div>
    `,
    () => {
      const actions = document.querySelector('.modal-actions');
      const signUpBtn = document.createElement('button');
      signUpBtn.textContent = 'Sign Up';
      actions.insertBefore(signUpBtn, document.getElementById('modalClose'));
      const doSubmit = async () => {
        const u = document.getElementById("regUser").value.trim();
        const e = document.getElementById("regEmail").value.trim();
        const p = document.getElementById("regPass").value.trim();
        if (!u || !e || !p) { showErr("Enter username, email, password"); return; }
        signUpBtn.disabled = true;
        try {
          const clientId = getCfgClientId();
          if (!clientId) throw new Error("Missing Cognito ClientId");
          await cognitoRequest("AWSCognitoIdentityProviderService.SignUp", {
            ClientId: clientId, Username: u, Password: p,
            UserAttributes: [ { Name: "email", Value: e } ]
          });
          // Step 2
          renderStep2(u);
        } catch (err) {
          showErr(err.message || 'Register failed');
        } finally { signUpBtn.disabled = false; }
      };
      function showErr(m){ const el=document.getElementById('regError'); el.textContent=m; el.style.display='block'; }
      document.getElementById('regPass').addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
      signUpBtn.onclick = doSubmit;
    }
  );

  // Confirm
  const renderStep2 = (prefillUser) => openModal(
    "Confirm Account",
    `
      <input id="confUser" placeholder="Username" value="${prefillUser || ''}">
      <input id="confCode" placeholder="Confirmation Code">
      <div class="hint">Check your email for the code.</div>
      <div id="confError" class="hint" style="color:#ff8888;display:none;"></div>
    `,
    () => {
      const actions = document.querySelector('.modal-actions');
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      const resendBtn = document.createElement('button');
      resendBtn.textContent = 'Resend Code';
      actions.insertBefore(resendBtn, document.getElementById('modalClose'));
      actions.insertBefore(confirmBtn, resendBtn);
      function showErr(m){ const el=document.getElementById('confError'); el.textContent=m; el.style.display='block'; }
      confirmBtn.onclick = async () => {
        const u = document.getElementById('confUser').value.trim();
        const c = document.getElementById('confCode').value.trim();
        if (!u || !c) { showErr('Enter username and code'); return; }
        confirmBtn.disabled = true;
        try {
          const clientId = getCfgClientId();
          if (!clientId) throw new Error("Missing Cognito ClientId");
          await cognitoRequest("AWSCognitoIdentityProviderService.ConfirmSignUp", {
            ClientId: clientId, Username: u, ConfirmationCode: c
          });
          closeModal();
          openLoginModal();
        } catch (err) { showErr(err.message || 'Confirm failed'); }
        finally { confirmBtn.disabled = false; }
      };
      resendBtn.onclick = async () => {
        const u = document.getElementById('confUser').value.trim();
        if (!u) { showErr('Enter username first'); return; }
        resendBtn.disabled = true;
        try {
          const clientId = getCfgClientId();
          if (!clientId) throw new Error("Missing Cognito ClientId");
          await cognitoRequest("AWSCognitoIdentityProviderService.ResendConfirmationCode", {
            ClientId: clientId, Username: u
          });
        } catch (err) { showErr(err.message || 'Resend failed'); }
        finally { resendBtn.disabled = false; }
      };
    }
  );

  renderStep1();
}
registerBtn.onclick = openRegisterModal;

// Logout wiring
const logoutBtn = document.getElementById("logoutBtn");
logoutBtn.onclick = logout;

// --- Forgot Password Modal ---
function openForgotModal() {
  // Request reset
  const step1 = () => openModal(
    "Reset Password",
    `
      <input id="fpUser" placeholder="Username">
      <div class="hint">We will email a reset code to your verified address.</div>
      <div id="fpError" class="hint" style="color:#ff8888;display:none;"></div>
    `,
    () => {
      const actions = document.querySelector('.modal-actions');
      const sendBtn = document.createElement('button');
      sendBtn.textContent = 'Send Code';
      actions.insertBefore(sendBtn, document.getElementById('modalClose'));
      function showErr(m){ const el=document.getElementById('fpError'); el.textContent=m; el.style.display='block'; }
      const doSend = async () => {
        const u = document.getElementById('fpUser').value.trim();
        if (!u) { showErr('Enter your username'); return; }
        sendBtn.disabled = true;
        try {
          const clientId = getCfgClientId();
          if (!clientId) throw new Error('Missing Cognito ClientId');
          await cognitoRequest('AWSCognitoIdentityProviderService.ForgotPassword', { ClientId: clientId, Username: u });
          step2(u);
        } catch (e) { showErr(e.message || 'Failed to send code'); }
        finally { sendBtn.disabled = false; }
      };
      sendBtn.onclick = doSend;
      document.getElementById('fpUser').addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
    }
  );
  // Confirm new password
  const step2 = (prefillUser) => openModal(
    "Enter Code",
    `
      <input id="fpUser2" placeholder="Username" value="${prefillUser || ''}">
      <input id="fpCode" placeholder="Reset Code">
      <input id="fpNewPass" type="password" placeholder="New Password">
      <div id="fp2Error" class="hint" style="color:#ff8888;display:none;"></div>
    `,
    () => {
      const actions = document.querySelector('.modal-actions');
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Update Password';
      actions.insertBefore(confirmBtn, document.getElementById('modalClose'));
      function showErr(m){ const el=document.getElementById('fp2Error'); el.textContent=m; el.style.display='block'; }
      const doConfirm = async () => {
        const u = document.getElementById('fpUser2').value.trim();
        const c = document.getElementById('fpCode').value.trim();
        const p = document.getElementById('fpNewPass').value.trim();
        if (!u || !c || !p) { showErr('Enter all fields'); return; }
        confirmBtn.disabled = true;
        try {
          const clientId = getCfgClientId();
          if (!clientId) throw new Error('Missing Cognito ClientId');
          await cognitoRequest('AWSCognitoIdentityProviderService.ConfirmForgotPassword', {
            ClientId: clientId, Username: u, ConfirmationCode: c, Password: p
          });
          closeModal();
          openLoginModal();
        } catch (e) { showErr(e.message || 'Failed to update password'); }
        finally { confirmBtn.disabled = false; }
      };
      confirmBtn.onclick = doConfirm;
      document.getElementById('fpNewPass').addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
    }
  );

  step1();
}

const roomSel = document.getElementById("room");

ROOMS.forEach((r) => {
    const o = document.createElement("option");
    o.value = r;
    o.textContent = r;
    roomSel.appendChild(o);
});

const aliasInput = document.getElementById("alias");
const messagesDiv = document.getElementById("messages");
const joinBtn = document.getElementById("join");
const sendBtn = document.getElementById("send");
const textInput = document.getElementById("text");

aliasInput.value = localStorage.getItem("alias") || "";

let socket = null;
let currentRoom = null;
let authAlerted = false;

function initSocket() {
  if (socket) return;
  const token = getIdToken();
  if (!token) return; // not logged in yet
  socket = io({ auth: { token } });

  socket.on("connect_error", () => {
    if (!authAlerted) {
      alert("Auth failed. Please log in.");
      authAlerted = true;
    }
    loginBtn.disabled = false;
    loginBtn.textContent = "Login with AWS";
  });

  socket.on("auth_ok", ({ username }) => {
    document.getElementById("alias").value = username;
  });

  socket.on("joined", ({ room }) => {
    currentRoom = room;
    messagesDiv.innerHTML = "";
    lastLoaded = 0;
    loadHistory(room);
  });

  socket.on("typing", ({ alias }) => {
    typingDiv.textContent = `${alias} is typing...`;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => (typingDiv.textContent = ""), 1500);
  });

  socket.on("message", addMsg);
  socket.on("error_msg", (m) => alert(m));
}

function colorForAlias(alias) {
    let hash = 0;
    for (let i = 0; i < alias.length; i++) hash = alias.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 75%)`;
}

function embedify(text) {
  if (!text) return "";
  let html = text.trim();

  // YouTube links
  const ytMatch = text.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (ytMatch) {
    html = `<iframe width="300" height="169"
      src="https://www.youtube.com/embed/${ytMatch[1]}"
      frameborder="0" allowfullscreen></iframe>`;
    return html;
  }

  // Direct image links
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(text)) {
    html = `<img src="${text}" style="max-width:200px;border:1px solid #ff66cc;border-radius:6px;">`;
    return html;
  }

  return html;
}

function addMsg({ alias, message, created_at }) {
    const d = new Date(created_at);
    const el = document.createElement("div");
    el.className = "msg";
    const color = colorForAlias(alias);
    el.innerHTML =
        `<span class="alias" style="color:${color}">${alias}</span>: ` +
        embedify(message) +
        ` <span class="time">${d.toLocaleTimeString()}</span>`;
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

const loadOlderBtn = document.getElementById("loadOlder");
let lastLoaded = 0;

async function loadHistory(room, limit = 50, offset = 0) {
  const idt = getIdToken();
  const res = await fetch(`/history/${encodeURIComponent(room)}?limit=${limit}&offset=${offset}`, {
    headers: idt ? { Authorization: `Bearer ${idt}` } : {}
  });
  const rows = await res.json();
  rows.forEach(addMsg);
  if (rows.length) lastLoaded += rows.length;
}

loadOlderBtn.onclick = () => {
  if (currentRoom) loadHistory(currentRoom, 50, lastLoaded);
};


const typingDiv = document.getElementById("typing");
let typingTimeout;

textInput.addEventListener("input", () => {
  if (!currentRoom) return;
  if (!socket) initSocket();
  if (!socket) return; // not logged in yet
  socket.emit("typing", { room: currentRoom, alias: aliasInput.value });
});

joinBtn.onclick = () => {
    const alias = aliasInput.value.trim();
    const room = roomSel.value;
    if (!alias) return alert("Pick an Alias!");
    localStorage.setItem("alias", alias);
    if (!socket) initSocket();
    if (!socket) return alert("Please log in first");
    socket.emit("join", { room, alias });
};

sendBtn.onclick = () => {
  const t = textInput.value.trim();
  if (!t || !currentRoom) return;

  if (t.startsWith("/")) {
    handleCommand(t);
  } else {
    if (!socket) initSocket();
    if (!socket) return alert("Please log in first");
    socket.emit("message", { text: t });
  }
  textInput.value = "";
};

function handleCommand(cmd) {
  if (!socket) initSocket();
  if (!socket) return alert("Please log in first");
  const [command, ...args] = cmd.slice(1).split(" ");

  switch (command.toLowerCase()) {
    case "me":
      socket.emit("message", {
        text: `<i>* ${aliasInput.value} ${args.join(" ")}</i>`
      });
      break;
    case "shrug":
      socket.emit("message", { text: "¯\\\\_(ツ)_/¯" });
      break;
    case "roll": {
      const dice = args[0] || "1d6";
      const [count, sides] = dice.split("d").map(Number);
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      socket.emit("message", {
        text: `<b>${aliasInput.value}</b> rolled ${dice}: <b>${total}</b> (${rolls.join(", ")})`
      });
      break;
    }
    case "clear":
      messagesDiv.innerHTML = "";
      break;
    default:
      socket.emit("message", { text: `<i>Unknown command:</i> ${command}` });
  }
}


const fileInput = document.getElementById("fileInput");

fileInput.addEventListener("change", async (e) => {
  const token = getIdToken();
  const file = e.target.files[0];
  if (!file || !currentRoom) return;

  const form = new FormData();
  form.append("image", file);

  const res = await fetch("/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) { alert("Upload failed"); return; }
  const { url } = await res.json();
  if (!socket) initSocket();
  if (!socket) return alert("Please log in first");
  socket.emit("message", { text: url });
  fileInput.value = ""; // reset
});

// --- Drag & Drop Uploads ---
messagesDiv.addEventListener("dragover", (e) => {
  e.preventDefault();
  messagesDiv.style.borderColor = "#ff99ff";
});

messagesDiv.addEventListener("dragleave", () => {
  messagesDiv.style.borderColor = "#ff66cc";
});

messagesDiv.addEventListener("drop", async (e) => {
  const token = getIdToken();

  e.preventDefault();
  messagesDiv.style.borderColor = "#ff66cc";
  const file = e.dataTransfer.files[0];
  if (!file || !currentRoom) return;

  const form = new FormData();
  form.append("image", file);

  const res = await fetch("/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) { alert("Upload failed"); return; }
  const { url } = await res.json();
  
  if (!socket) initSocket();
  if (!socket) return alert("Please log in first");
  socket.emit("message", {
    text: url
  });
});


textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
});

// If already logged in (tokens exist), initialize socket now
if (savedId) {
  initSocket();
}
