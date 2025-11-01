const CFG = window.HECHAT_CONFIG || {};
const ROOMS = Array.isArray(CFG.rooms) ? CFG.rooms : [];

// --- Cognito ---
// Allow overrides from localStorage; read from window.HECHAT_CONFIG live
function getCfgRegion() {
  return (
    localStorage.getItem("cog_region") ||
    (window.HECHAT_CONFIG && window.HECHAT_CONFIG.region) ||
    CFG.region ||
    "us-east-1"
  );
}
function getCfgClientId() {
  return (
    localStorage.getItem("cog_client_id") ||
    (window.HECHAT_CONFIG && window.HECHAT_CONFIG.clientId) ||
    CFG.clientId ||
    ""
  );
}
function getCfgUserPoolId() {
  return (
    localStorage.getItem("cog_user_pool_id") ||
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
  try {
    const clientId = getCfgClientId();
    if (!clientId) throw new Error("Missing Cognito ClientId (configure in settings)");
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
    alert("Login successful!");
    loginForm.style.display = "none";
    loginBtn.textContent = "Logged In ✓";
    loginBtn.disabled = true;
    location.reload();
  } catch (err) {
    alert("Login failed: " + err.message);
  }
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

// --- Basic inline login UI ---
const loginBtn = document.getElementById("loginBtn");
const loginForm = document.createElement("div");
loginForm.innerHTML = `
  <input id="userField" placeholder="Username" style="width:100%;margin-bottom:4px;">
  <input id="passField" type="password" placeholder="Password" style="width:100%;margin-bottom:4px;">
  <button id="doLogin" style="width:100%">Submit</button>
`;
loginForm.style.display = "none";
document.getElementById("left").insertBefore(loginForm, loginBtn.nextSibling);

loginBtn.onclick = () => {
  loginForm.style.display = loginForm.style.display === "none" ? "block" : "none";
};
document.getElementById("doLogin").onclick = () => {
  const u = document.getElementById("userField").value.trim();
  const p = document.getElementById("passField").value.trim();
  if (!u || !p) return alert("Enter username & password");
  loginDirect(u, p);
};

// Auto-mark logged-in state
const savedId = getIdToken();
if (savedId) {
  loginBtn.textContent = "Logged In ✓";
  loginBtn.disabled = true;
}

// --- Register UI ---
const leftPanel = document.getElementById("left");
const registerBtn = document.createElement("button");
registerBtn.id = "registerBtn";
registerBtn.textContent = "Register";
leftPanel.insertBefore(registerBtn, loginForm.nextSibling);

const registerForm = document.createElement("div");
registerForm.style.display = "none";
registerForm.innerHTML = `
  <input id="regUser" placeholder="Username" style="width:100%;margin-top:6px;margin-bottom:4px;">
  <input id="regEmail" type="email" placeholder="Email" style="width:100%;margin-bottom:4px;">
  <input id="regPass" type="password" placeholder="Password" style="width:100%;margin-bottom:4px;">
  <button id="doRegister" style="width:100%">Sign Up</button>
  <div id="confirmBlock" style="display:none;margin-top:6px;">
    <input id="confUser" placeholder="Username" style="width:100%;margin-bottom:4px;">
    <input id="confCode" placeholder="Confirmation Code" style="width:100%;margin-bottom:4px;">
    <button id="doConfirm" style="width:100%">Confirm</button>
    <button id="resendCode" style="width:100%;margin-top:4px;">Resend Code</button>
  </div>
`;
leftPanel.insertBefore(registerForm, registerBtn.nextSibling);

registerBtn.onclick = () => {
  registerForm.style.display = registerForm.style.display === "none" ? "block" : "none";
};

document.getElementById("doRegister").onclick = async () => {
  const u = document.getElementById("regUser").value.trim();
  const e = document.getElementById("regEmail").value.trim();
  const p = document.getElementById("regPass").value.trim();
  if (!u || !e || !p) return alert("Enter username, email, password");
  try {
    const clientId = getCfgClientId();
    if (!clientId) throw new Error("Missing Cognito ClientId (configure in settings)");
    await cognitoRequest("AWSCognitoIdentityProviderService.SignUp", {
      ClientId: clientId,
      Username: u,
      Password: p,
      UserAttributes: [ { Name: "email", Value: e } ]
    });
    alert("Sign-up started. Check email for code.");
    // show confirm block prefilled
    document.getElementById("confUser").value = u;
    document.getElementById("confirmBlock").style.display = "block";
  } catch (err) {
    alert("Register failed: " + err.message);
  }
};

document.getElementById("doConfirm").onclick = async () => {
  const u = document.getElementById("confUser").value.trim();
  const c = document.getElementById("confCode").value.trim();
  if (!u || !c) return alert("Enter username and code");
  try {
    const clientId = getCfgClientId();
    if (!clientId) throw new Error("Missing Cognito ClientId (configure in settings)");
    await cognitoRequest("AWSCognitoIdentityProviderService.ConfirmSignUp", {
      ClientId: clientId,
      Username: u,
      ConfirmationCode: c
    });
    alert("Confirmed! You can now login.");
    document.getElementById("confirmBlock").style.display = "none";
    registerForm.style.display = "none";
  } catch (err) {
    alert("Confirm failed: " + err.message);
  }
};

document.getElementById("resendCode").onclick = async () => {
  const u = document.getElementById("confUser").value.trim();
  if (!u) return alert("Enter username first");
  try {
    const clientId = getCfgClientId();
    if (!clientId) throw new Error("Missing Cognito ClientId (configure in settings)");
    await cognitoRequest("AWSCognitoIdentityProviderService.ResendConfirmationCode", {
      ClientId: clientId,
      Username: u
    });
    alert("Code resent");
  } catch (err) {
    alert("Resend failed: " + err.message);
  }
};

// Logout wiring
const logoutBtn = document.getElementById("logoutBtn");
logoutBtn.onclick = logout;

// --- Cognito Settings  ---
const settingsBtn = document.createElement("button");
settingsBtn.id = "settingsBtn";
settingsBtn.textContent = "Cognito Settings";
leftPanel.insertBefore(settingsBtn, registerForm.nextSibling);

const settingsForm = document.createElement("div");
settingsForm.style.display = "none";
settingsForm.innerHTML = `
  <input id="setRegion" placeholder="Region (e.g. us-east-1)" style="width:100%;margin-top:6px;margin-bottom:4px;">
  <input id="setUserPool" placeholder="User Pool Id" style="width:100%;margin-bottom:4px;">
  <input id="setClientId" placeholder="App Client Id" style="width:100%;margin-bottom:4px;">
  <button id="saveSettings" style="width:100%">Save Settings</button>
`;
leftPanel.insertBefore(settingsForm, settingsBtn.nextSibling);

function hydrateSettingsFields() {
  document.getElementById("setRegion").value = getCfgRegion();
  document.getElementById("setUserPool").value = getCfgUserPoolId();
  document.getElementById("setClientId").value = getCfgClientId();
}
hydrateSettingsFields();

settingsBtn.onclick = () => {
  settingsForm.style.display = settingsForm.style.display === "none" ? "block" : "none";
  if (settingsForm.style.display === "block") hydrateSettingsFields();
};

document.getElementById("saveSettings").onclick = () => {
  const r = document.getElementById("setRegion").value.trim();
  const up = document.getElementById("setUserPool").value.trim();
  const cid = document.getElementById("setClientId").value.trim();
  if (r) localStorage.setItem("cog_region", r);
  if (up) localStorage.setItem("cog_user_pool_id", up);
  if (cid) localStorage.setItem("cog_client_id", cid);
  alert("Saved. You can now Register/Login.");
};

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
