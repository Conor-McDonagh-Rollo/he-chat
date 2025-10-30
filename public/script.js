const ROOMS = window.ROOMS;
const CFG = window.HECHAT_CONFIG || {};

// --- Cognito ---
const AWS_REGION = CFG.region;
const COGNITO_USER_POOL_ID = CFG.userPoolId;
const COGNITO_CLIENT_ID = CFG.clientId;
const COGNITO_DOMAIN = CFG.domain || `https://${COGNITO_USER_POOL_ID}.auth.${AWS_REGION}.amazoncognito.com`; // replace if you use a custom domain
const REDIRECT_URI = window.location.origin;

// --- Token handling ---
function getTokenFromUrl() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const params = new URLSearchParams(hash);
  return params.get("id_token") || params.get("access_token");
}

function saveToken(t) { localStorage.setItem("cognito_token", t); }
function getSavedToken() { return localStorage.getItem("cognito_token"); }
function clearToken() { localStorage.removeItem("cognito_token"); }

function redirectToLogin() {
  const REDIRECT_URI = window.location.origin;
  const url =
    `${COGNITO_DOMAIN}/login?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
    `&response_type=token&scope=openid+email+profile&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  window.location.href = url;
}

loginBtn.onclick = redirectToLogin;
logoutBtn.onclick = () => { clearToken(); window.location.reload(); };

(function bootstrapAuth() {
  const token = getTokenFromUrl();
  if (token) {
    saveToken(token);
    history.replaceState({}, document.title, window.location.pathname); // clean URL
  }
  const saved = getSavedToken();
  if (saved) {
    loginBtn.textContent = "Logged In ✓";
    loginBtn.disabled = true;
  }
})();

function handleLogin() {
  const token = getTokenFromUrl();
  if (token) {
    saveToken(token);
    // Clear URL hash so it looks clean
    history.replaceState({}, document.title, window.location.pathname);
  }
  const saved = getSavedToken();
  if (saved) {
    socket.emit("auth", { token: saved });
    document.getElementById("loginBtn").textContent = "Logged In ✓";
    document.getElementById("loginBtn").disabled = true;
  }
}

document.getElementById("loginBtn").onclick = redirectToLogin;

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

const token = getSavedToken();
const socket = io({ auth: { token } });
let currentRoom = null;

socket.on("connect_error", (err) => {
  alert("Auth failed. Please log in.");
  loginBtn.disabled = false;
  loginBtn.textContent = "Login with AWS";
});

socket.on("auth_ok", ({ username }) => {
  document.getElementById("alias").value = username;
});

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
  const res = await fetch(`/history/${encodeURIComponent(room)}?limit=${limit}&offset=${offset}`);
  const rows = await res.json();
  rows.forEach(addMsg);
  if (rows.length) lastLoaded += rows.length;
}

loadOlderBtn.onclick = () => {
  if (currentRoom) loadHistory(currentRoom, 50, lastLoaded);
};

socket.on("joined", ({ room }) => {
  currentRoom = room;
  messagesDiv.innerHTML = "";
  lastLoaded = 0;
  loadHistory(room);
});


const typingDiv = document.getElementById("typing");
let typingTimeout;

textInput.addEventListener("input", () => {
  if (!currentRoom) return;
  socket.emit("typing", { room: currentRoom, alias: aliasInput.value });
});

socket.on("typing", ({ alias }) => {
  typingDiv.textContent = `${alias} is typing...`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => (typingDiv.textContent = ""), 1500);
});

joinBtn.onclick = () => {
    const alias = aliasInput.value.trim();
    const room = roomSel.value;
    if (!alias) return alert("Pick an Alias!");
    localStorage.setItem("alias", alias);
    socket.emit("join", { room, alias });
};

sendBtn.onclick = () => {
  const t = textInput.value.trim();
  if (!t || !currentRoom) return;

  if (t.startsWith("/")) {
    handleCommand(t);
  } else {
    socket.emit("message", { text: t });
  }
  textInput.value = "";
};

function handleCommand(cmd) {
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
  const token = getSavedToken();
  const file = e.target.files[0];
  if (!file || !currentRoom) return;

  const form = new FormData();
  form.append("image", file);

  const res = await fetch("/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) { alert("Upload failed"); return; }
  const { url } = await res.json();

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
  const token = getSavedToken();

  e.preventDefault();
  messagesDiv.style.borderColor = "#ff66cc";
  const file = e.dataTransfer.files[0];
  if (!file || !currentRoom) return;

  const form = new FormData();
  form.append("image", file);

  const res = await fetch("/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) { alert("Upload failed"); return; }
  const { url } = await res.json();
  
  socket.emit("message", {
    text: url
  });
});


textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
});

socket.on("message", addMsg);

socket.on("error_msg", (m) => alert(m));

// Run login check as soon as page loads
handleLogin();
